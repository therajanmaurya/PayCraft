export const runtime = "edge"

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const origin = requestUrl.origin

  if (!code) {
    return NextResponse.redirect(new URL("/auth/login", origin))
  }

  // Create the redirect response FIRST so auth cookies land on this exact
  // response object — not on a separate cookieStore that won't transfer.
  const response = NextResponse.redirect(new URL("/subscribers", origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message)
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, origin)
    )
  }

  // Route first-time sign-ins to /onboarding so the user names the app.
  // Returning users with at least one tenant_admins row go to the dashboard
  // (the previous default — /subscribers).
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    // Does the user admin AT LEAST ONE tenant? `.limit(1).maybeSingle()` returns the first
    // membership (or null) and — unlike a bare `.maybeSingle()` — does NOT error when the user
    // owns multiple tenants. The bare form threw for any ≥2-tenant owner, making `existing` null
    // and wrongly bouncing returning multi-tenant admins to /onboarding on every login.
    const { data: existing } = await supabase
      .from("tenant_admins")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()

    if (!existing) {
      return NextResponse.redirect(new URL("/onboarding", origin), { headers: response.headers })
    }
  }

  return response
}