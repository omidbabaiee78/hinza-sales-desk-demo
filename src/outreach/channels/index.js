// ---------------------------------------------------------------------------
// Channel adapter contract for Phase 21+ real providers (WhatsApp Cloud API,
// SMS gateway, email provider). Each adapter module exports:
//   key            - matches the outreach_attempts.channel / eligibility
//                     engine's channel value ('whatsapp' | 'phone' | 'sms' | 'email')
//   label          - Persian display label
//   canHandle(lead)  - true if the lead has the data this channel needs
//   prepare(ctx)   - builds the manual-execution payload (a href, or text to
//                    copy) - never calls a provider, never performs an
//                    external effect
//   execute        - INTENTIONALLY NOT IMPLEMENTED in Phase 19. Every
//                    adapter's execute() throws, so it is structurally
//                    impossible for this phase's code to perform a real
//                    provider send even by accident. Phase 21 replaces this
//                    with a real implementation per channel, without
//                    touching eligibility/selection/composer logic.
// ---------------------------------------------------------------------------

export function disabledExecute(channelKey) {
  return function execute() {
    throw new Error(
      `outreach channel "${channelKey}": provider execution is disabled in this phase (shadow/manual mode only).`,
    )
  }
}
