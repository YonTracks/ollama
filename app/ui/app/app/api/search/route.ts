import { NextResponse } from "next/server";
import {
  configuredProvider,
  providerValue,
  resultCount,
  search,
  SearchProviderError
} from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const provider = providerValue(url.searchParams.get("provider")) ?? undefined;

  if (!query) {
    return NextResponse.json(
      {
        provider: "off",
        disabled: false,
        query,
        results: [],
        error: "Missing search query."
      },
      { status: 400 }
    );
  }

  try {
    const response = await search({
      query,
      provider,
      count: resultCount(numberParam(url.searchParams.get("count"))),
      safe: booleanParam(url.searchParams.get("safe")),
      signal: request.signal
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof SearchProviderError) {
      return NextResponse.json(
        {
          provider: provider ?? configuredProvider(),
          query,
          disabled: false,
          results: [],
          error: error.message
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        provider: "custom",
        query,
        disabled: false,
        results: [],
        error: "Search failed unexpectedly."
      },
      { status: 500 }
    );
  }
}

function numberParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanParam(value: string | null) {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}
