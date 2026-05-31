// Findings chips are contextual to job type (PRD: "HVAC chips differ from
// plumbing chips"). Selected chips feed the AI resolution summary.
export const FINDING_CHIPS = {
  hvac: [
    'Thermostat recalibrated',
    'Refrigerant low',
    'Compressor fault',
    'Air filter replaced',
    'Fan motor checked',
    'Coils cleaned',
    'Part needed',
  ],
  plumbing: [
    'Clog cleared',
    'Drain snaked',
    'Washer replaced',
    'Leak at valve',
    'Seal replaced',
    'Pipe damage',
    'Part needed',
  ],
  electrical: [
    'Bulb replaced',
    'Fixture replaced',
    'Breaker reset',
    'Wiring inspected',
    'Outlet tested',
    'Part needed',
  ],
  general: ['Adjusted', 'Replaced', 'Tightened', 'Cleaned', 'Realigned', 'Part needed'],
}

// PRD escalate screen reason chips.
export const ESCALATION_REASONS = [
  "Need a part I don't have",
  'Requires specialist',
  'Safety concern',
  "Can't access room",
  'Unclear what’s wrong',
]

// Flag dot legend (color-coded, no text labels on cards).
export const FLAG_LEGEND = [
  { key: 'occupied', color: 'var(--flag-occupied)', label: 'Occupied' },
  { key: 'vip', color: 'var(--flag-vip)', label: 'VIP guest' },
  { key: 'repeat_issue', color: 'var(--flag-repeat)', label: 'Repeat issue' },
  { key: 'checkout_imminent', color: 'var(--flag-checkout)', label: 'Checkout soon' },
]

// Display labels (DB values are urgent/high/normal; we surface them as High/Medium/Low).
export const PRIORITY_LABEL = { urgent: 'High', high: 'Medium', normal: 'Low' }

// Hotel the tech works for — shown in the UI and used in guest messages.
export const HOTEL_NAME = 'The Grimmauld'
