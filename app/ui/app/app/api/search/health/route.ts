import { NextResponse } from "next/server";
import { configuredProvider, providerValue, searchProviderHealth } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = providerValue(url.searchParams.get("provider")) ?? configuredProvider();

  return NextResponse.json(searchProviderHealth(provider));
}
