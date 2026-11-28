/*
  PostHog, loaded lazily and only when the server reports a project key
  (POSTHOG_KEY). With no key nothing is loaded and no cookie is set, so the
  site ships clean until the key is added. Session replay and autocapture are
  off; we count page views and the lead-form events listed below.
*/
import { publicConfig } from './portal'

type Posthog = typeof import('posthog-js').default
let ph: Posthog | null = null
let started = false

export async function initAnalytics(): Promise<void> {
  if (started) return
  started = true
  try {
    const cfg = await publicConfig()
    if (!cfg.posthogKey) return
    const mod = await import('posthog-js')
    ph = mod.default
    ph.init(cfg.posthogKey, {
      api_host: cfg.posthogHost,
      capture_pageview: false,
      autocapture: false,
      disable_session_recording: true,
      persistence: 'localStorage',
      respect_dnt: true,
    })
  } catch {
    /* analytics must never break the site */
  }
}

export function trackPage(path: string): void {
  ph?.capture('$pageview', { $current_url: window.location.origin + path })
}

export function track(event: 'lead_form_started' | 'lead_submitted' | 'cta_clicked', props?: Record<string, string>): void {
  ph?.capture(event, props)
}
