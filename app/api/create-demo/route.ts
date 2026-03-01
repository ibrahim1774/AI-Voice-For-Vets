import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const VET_KNOWLEDGE = {
  primaryGoal: "Book a pet appointment",
  keyInfo:
    "Pet name and species (dog, cat, other), breed and age, new or existing client, reason for visit (wellness exam, vaccinations, illness, injury, dental cleaning, spay/neuter), preferred date/time, any urgency or symptoms",
  scenarios:
    "New client wanting to register and book first visit, existing client needing wellness exam or vaccinations, sick pet or injury (vomiting, limping, lethargy), emergency or after-hours urgent care, spay/neuter or dental cleaning scheduling, prescription refill requests, boarding or grooming inquiries",
  pricingBehavior:
    'Say "our exam fees and procedure costs vary depending on your pet\'s needs — our team will provide a detailed estimate before any treatment. We accept most pet insurance plans"',
  schedulingNotes:
    "Differentiate between wellness visits (routine), sick visits (may need same-day), and surgical procedures (require pre-op instructions). Ask about the pet's symptoms to gauge urgency",
};

interface CreateDemoRequest {
  practiceName: string;
  phoneNumber: string;
  goal: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateDemoRequest = await request.json();

    // Validate input
    if (!body.practiceName?.trim()) {
      return NextResponse.json(
        { error: "Practice name is required" },
        { status: 400 }
      );
    }

    const phoneDigits = (body.phoneNumber || "").replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      return NextResponse.json(
        { error: "A valid phone number is required" },
        { status: 400 }
      );
    }

    if (!body.goal?.trim()) {
      return NextResponse.json(
        { error: "Please select a goal" },
        { status: 400 }
      );
    }

    const primaryGoal = body.goal;

    // Step 1: Generate custom veterinary receptionist system prompt with Claude
    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are an expert at creating AI receptionist system prompts for veterinary practices. Generate a custom system prompt for this veterinary practice:

Veterinary Practice Name: "${body.practiceName}"

This receptionist answers phone calls for this veterinary practice. Here is what you need to know:

Primary goal selected by the practice: ${primaryGoal}
Information to gather from callers: ${VET_KNOWLEDGE.keyInfo}
Common caller scenarios to handle: ${VET_KNOWLEDGE.scenarios}
How to handle pricing questions: ${VET_KNOWLEDGE.pricingBehavior}
Scheduling notes: ${VET_KNOWLEDGE.schedulingNotes}

The system prompt you generate must:

1. Greet callers warmly using the practice name: "${body.practiceName}"
2. Sound like a real human veterinary receptionist — use contractions, casual phrasing, and a friendly, reassuring tone
3. Follow the veterinary-specific booking flow above — ask the right questions in a natural conversational order, not all at once
4. Ask ONE question at a time, wait for the answer, then ask the next
5. Always work toward the primary goal: "${primaryGoal}" — prioritize this above all else in every conversation
6. Handle the common veterinary scenarios listed above naturally — be especially empathetic with worried pet owners or pet emergencies
7. Use the pricing guidance above when pricing comes up — never make up specific prices
8. Keep every response to 1-3 sentences max — this is a phone call, not an email
9. If the caller asks something outside your knowledge, say "Let me have someone from our team get back to you on that — can I grab your name and number?"
10. Always capture the caller's name and callback number before ending the call
11. Never mention being AI unless directly asked
12. Never fabricate information about the practice — don't make up veterinarian names, office hours, or specific services not mentioned

Return ONLY the system prompt text. No markdown formatting, no explanations, no quotation marks wrapping it.`,
        },
      ],
    });

    const systemPrompt =
      claudeResponse.content[0].type === "text"
        ? claudeResponse.content[0].text
        : "";

    if (!systemPrompt) {
      throw new Error("Failed to generate system prompt");
    }

    // Step 2: Create Vapi assistant with the custom veterinary prompt
    const vapiResponse = await fetch("https://api.vapi.ai/assistant", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Demo - ${body.practiceName}`.slice(0, 40),
        model: {
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
          systemPrompt: systemPrompt,
          temperature: 0.7,
          maxTokens: 300,
        },
        voice: {
          provider: "11labs",
          voiceId: "paula",
        },
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: "en-US",
          keywords: [
            "veterinary:2",
            "vet:2",
            "vaccination:2",
            "vaccine:2",
            "spay:2",
            "neuter:2",
            "feline:2",
            "canine:2",
            "checkup:2",
            "heartworm:2",
            "flea:2",
            "tick:2",
            "rabies:2",
            "parvo:2",
            "distemper:2",
            "microchip:2",
            "dental:2",
            "cleaning:2",
            "surgery:2",
            "X-ray:2",
            "bloodwork:2",
            "urinalysis:2",
            "deworming:2",
            "boarding:2",
            "grooming:2",
            "puppy:2",
            "kitten:2",
            "exotic:2",
          ],
        },
        firstMessage: `Thanks for calling ${body.practiceName}, how can I help you today?`,
        firstMessageMode: "assistant-speaks-first",
      }),
    });

    if (!vapiResponse.ok) {
      const vapiError = await vapiResponse.json().catch(() => ({}));
      console.error("Vapi API error:", vapiError);
      const errorMessage = vapiError?.message || vapiError?.error || JSON.stringify(vapiError);
      throw new Error(`Failed to create AI assistant: ${errorMessage}`);
    }

    const assistant = await vapiResponse.json();

    return NextResponse.json({
      assistantId: assistant.id,
      practiceName: body.practiceName,
    });
  } catch (error) {
    console.error("Create demo error:", error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        {
          error: `AI service error: ${error.message}`,
        },
        { status: error.status || 503 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "We hit a snag building your receptionist. Please try again.",
      },
      { status: 500 }
    );
  }
}
