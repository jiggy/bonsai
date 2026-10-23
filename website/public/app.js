'use strict'

const demoFrame = document.querySelector('.demo-frame')
const helperToggles = [...document.querySelectorAll('[data-helper-toggle]')]
let helperAdded = false
function toggleHelper() {
  helperAdded = !helperAdded
  demoFrame.classList.toggle('is-rejected', helperAdded)
  helperToggles.forEach((button) => button.setAttribute('aria-pressed', String(helperAdded)))
  document.querySelectorAll('[data-helper-label]').forEach((label) => {
    label.textContent = helperAdded ? 'Prune the unused helper' : 'Add an unused helper'
  })
  document.querySelectorAll('[data-helper-icon]').forEach((icon) => {
    icon.textContent = helperAdded ? '−' : '+'
  })
  document.querySelectorAll('.orphan-line').forEach((line) => {
    line.hidden = !helperAdded
  })
  const states = helperAdded
    ? {
        'demo-verdict': 'Passing tests. Unsupported code.',
        'demo-summary': 'The helper has no path to a required contract.',
        'demo-tokens': '228',
        'demo-untraced': '1 untraced symbol',
        'demo-explanation':
          'All three checks still pass. The unused helper still blocks acceptance.',
        'verdict-icon': '×',
      }
    : {
        'demo-verdict': 'Room to grow.',
        'demo-summary': 'Required behavior. Justified code. Within budget.',
        'demo-tokens': '212',
        'demo-untraced': '0',
        'demo-explanation':
          'The helper is gone. Required behavior is preserved. The candidate passes.',
        'verdict-icon': '✓',
      }
  for (const [id, value] of Object.entries(states)) document.getElementById(id).textContent = value
  const badge = document.getElementById('demo-badge')
  badge.textContent = helperAdded ? 'Reject' : 'Pass'
  badge.className = 'badge ' + (helperAdded ? 'reject-badge' : 'pass-badge')
  const note = document.getElementById('source-note')
  note.replaceChildren()
  const dot = document.createElement('span')
  dot.className = 'note-dot'
  note.append(dot)
  note.append(
    helperAdded
      ? 'unusedHelper has no contract ancestry.'
      : 'Both functions trace to the checkout contract.',
  )
  document.getElementById('budget-fill').style.width = helperAdded ? '57%' : '53%'
  document.getElementById('graph-orphan').hidden = !helperAdded
  document.getElementById('ring-tokens').textContent = helperAdded ? '228' : '212'
  document.getElementById('ring-retained').textContent = helperAdded ? '228 tokens' : '212 tokens'
  document.getElementById('ring-headroom').textContent = helperAdded ? '172 tokens' : '188 tokens'
  document
    .getElementById('ring-value')
    .setAttribute('stroke-dasharray', helperAdded ? '57 100' : '53 100')
}
helperToggles.forEach((button) => button.addEventListener('click', toggleHelper))

const walkthroughTabs = [...document.querySelectorAll('.stage-tabs [role="tab"]')]
const previousView = document.getElementById('walkthrough-previous')
const nextView = document.getElementById('walkthrough-next')
function selectWalkthrough(tab, focus = false) {
  const index = walkthroughTabs.indexOf(tab)
  walkthroughTabs.forEach((item) => {
    const active = item === tab
    item.setAttribute('aria-selected', String(active))
    item.tabIndex = active ? 0 : -1
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active
  })
  document.querySelectorAll('[data-walkthrough-position]').forEach((label) => {
    label.textContent = `${index + 1} / ${walkthroughTabs.length} · ${tab.textContent}`
  })
  const previous = walkthroughTabs[(index + walkthroughTabs.length - 1) % walkthroughTabs.length]
  const next = walkthroughTabs[(index + 1) % walkthroughTabs.length]
  previousView.setAttribute('aria-label', `Previous view: ${previous.textContent}`)
  nextView.setAttribute('aria-label', `Next view: ${next.textContent}`)
  previousView.title = `Previous: ${previous.textContent}`
  nextView.title = `Next: ${next.textContent}`
  if (focus) tab.focus()
}
function moveWalkthrough(direction) {
  const index = walkthroughTabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
  selectWalkthrough(
    walkthroughTabs[(index + direction + walkthroughTabs.length) % walkthroughTabs.length],
  )
}
previousView.addEventListener('click', () => moveWalkthrough(-1))
nextView.addEventListener('click', () => moveWalkthrough(1))
walkthroughTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectWalkthrough(tab))
  tab.addEventListener('keydown', (event) => {
    const destinations = {
      ArrowRight: (index + 1) % walkthroughTabs.length,
      ArrowLeft: (index + walkthroughTabs.length - 1) % walkthroughTabs.length,
      Home: 0,
      End: walkthroughTabs.length - 1,
    }
    if (event.key in destinations) {
      event.preventDefault()
      selectWalkthrough(walkthroughTabs[destinations[event.key]], true)
    }
  })
})
selectWalkthrough(walkthroughTabs[0])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const formatTokens = (value) => value.toLocaleString('en-US')
const allowance = (surface) => 20000 + 2000 * Math.log2(surface / 20)
const chartX = (surface) => 60 + ((surface - 20) / 140) * 416
const chartY = (tokens) => 190 - ((tokens - 16000) / 12000) * 160
const chart = document.querySelector('.curve-chart')
const surfaceRange = document.getElementById('surface-range')
const usageRange = document.getElementById('usage-range')
const surfaceOutput = document.getElementById('surface-output')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let selectedSurface = -1
let retainedTokens = Number(usageRange.value)
let manuallyControlled = false
let scrollFrame = 0

function curveThrough(start, end) {
  let path = `M${chartX(start).toFixed(2)} ${chartY(allowance(start)).toFixed(2)} `
  for (let value = Math.floor(start) + 1; value < end; value++) {
    path += `L${chartX(value).toFixed(2)} ${chartY(allowance(value)).toFixed(2)} `
  }
  return path + `L${chartX(end).toFixed(2)} ${chartY(allowance(end)).toFixed(2)} `
}
document.getElementById('curve-path').setAttribute('d', curveThrough(20, 160))

function renderUsage() {
  const usedY = chartY(retainedTokens)
  const intersection = 20 * 2 ** ((retainedTokens - 20000) / 2000)
  const boundary = clamp(intersection, 20, 160)
  const areaBetween = (start, end) =>
    end <= start
      ? ''
      : curveThrough(start, end) +
        `L${chartX(end).toFixed(2)} ${usedY.toFixed(2)} L${chartX(start).toFixed(2)} ${usedY.toFixed(2)} Z`
  document.getElementById('curve-over-area').setAttribute('d', areaBetween(20, boundary))
  document.getElementById('curve-room-area').setAttribute('d', areaBetween(boundary, 160))
  document.getElementById('usage-path').setAttribute('d', `M60 ${usedY}H476`)
  const crossing = document.getElementById('curve-crossing')
  crossing.toggleAttribute('hidden', intersection < 20 || intersection > 160)
  crossing.setAttribute('cx', chartX(boundary))
  crossing.setAttribute('cy', usedY)
  const boundaryText =
    intersection < 20
      ? 'Retained source stays below the allowance throughout this range.'
      : intersection > 160
        ? 'Retained source exceeds the allowance throughout this range.'
        : `Size fits from ${Math.ceil(intersection)} contract pairs.`
  document.getElementById('curve-description').textContent =
    `The solid purple allowance curve rises from 20,000 tokens at 20 contract pairs to 26,000 at 160. The dashed retained-source line is held at ${formatTokens(retainedTokens)} tokens, independently of contract surface. ${boundaryText} Shading above the allowance indicates code to prune; shading below it indicates headroom.`
  document.getElementById('curve-used').textContent = formatTokens(retainedTokens)
  document.getElementById('usage-output').textContent = `${formatTokens(retainedTokens)} tokens`
  usageRange.style.setProperty('--range-progress', `${((retainedTokens - 18000) / 10000) * 100}%`)
}

function renderBudget() {
  const ceiling = Math.floor(allowance(selectedSurface))
  const gap = ceiling - retainedTokens
  const x = chartX(selectedSurface)
  document.getElementById('curve-guide').setAttribute('d', `M${x} 30V190`)
  document.getElementById('curve-dot').setAttribute('cx', x)
  document.getElementById('curve-dot').setAttribute('cy', chartY(ceiling))
  document.getElementById('usage-dot').setAttribute('cx', x)
  document.getElementById('usage-dot').setAttribute('cy', chartY(retainedTokens))
  document.getElementById('curve-ceiling').textContent = formatTokens(ceiling)
  const result = document.getElementById('curve-result')
  result.classList.toggle('is-over-budget', gap < 0)
  result.classList.toggle('is-within-budget', gap >= 0)
  document.getElementById('curve-result-icon').textContent = gap < 0 ? '↘' : '↗'
  document.getElementById('curve-gap').textContent =
    gap < 0
      ? `${formatTokens(-gap)} tokens to prune.`
      : gap === 0
        ? 'Exactly at the size ceiling.'
        : `${formatTokens(gap)} tokens of headroom.`
  const sizeResult =
    gap < 0
      ? `${formatTokens(-gap)} tokens over size budget`
      : `${formatTokens(gap)} tokens of headroom`
  surfaceRange.setAttribute(
    'aria-valuetext',
    `${selectedSurface} contract pairs; allowance ${formatTokens(ceiling)} tokens; retained source ${formatTokens(retainedTokens)} tokens; ${sizeResult}`,
  )
  usageRange.setAttribute(
    'aria-valuetext',
    `${formatTokens(retainedTokens)} retained tokens; ${sizeResult} at ${selectedSurface} contract pairs`,
  )
}

function takeManualControl() {
  manuallyControlled = true
}
;[surfaceRange, usageRange].forEach((range) => range.addEventListener('focus', takeManualControl))

function selectSurface(rawSurface, source = 'manual') {
  if (source === 'manual') takeManualControl()
  const surface = clamp(Math.round(Number(rawSurface)), 20, 160)
  if (surface === selectedSurface) return
  selectedSurface = surface
  surfaceRange.value = String(surface)
  surfaceOutput.textContent = `${surface} pairs`
  surfaceRange.style.setProperty('--range-progress', `${((surface - 20) / 140) * 100}%`)
  renderBudget()
}

usageRange.addEventListener('input', () => {
  takeManualControl()
  retainedTokens = Number(usageRange.value)
  renderUsage()
  renderBudget()
})

surfaceRange.addEventListener('input', () => selectSurface(surfaceRange.value))
chart.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
  const bounds = chart.getBoundingClientRect()
  if (!bounds.width) return
  const x = ((event.clientX - bounds.left) / bounds.width) * 500
  if (x >= 60 && x <= 476) {
    selectSurface(20 + ((x - 60) / 416) * 140)
  }
})

function followScroll() {
  scrollFrame = 0
  if (manuallyControlled || reducedMotion.matches) return
  const bounds = chart.getBoundingClientRect()
  if (!bounds.width || !bounds.height || window.innerHeight <= 0) return
  const progress = clamp(
    (window.innerHeight * 0.9 - bounds.top) / (window.innerHeight * 0.55),
    0,
    1,
  )
  selectSurface(20 + progress * 140, 'scroll')
}
function scheduleScroll() {
  if (!scrollFrame && !manuallyControlled && !reducedMotion.matches)
    scrollFrame = requestAnimationFrame(followScroll)
}
window.addEventListener('scroll', scheduleScroll, { passive: true })
window.addEventListener('resize', scheduleScroll)
window.addEventListener('load', scheduleScroll, { once: true })
reducedMotion.addEventListener('change', scheduleScroll)
renderUsage()
selectSurface(20, 'initial')
scheduleScroll()

const copyButton = document.getElementById('copy-command')
copyButton.addEventListener('click', async () => {
  const commands = document.getElementById('quickstart-code').textContent.trim()
  try {
    await navigator.clipboard.writeText(commands)
    copyButton.querySelector('span').textContent = 'Copied'
    document.getElementById('copy-feedback').textContent = 'Quickstart commands copied.'
    setTimeout(() => {
      copyButton.querySelector('span').textContent = 'Copy'
      document.getElementById('copy-feedback').textContent = ''
    }, 3000)
  } catch {
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('quickstart-code'))
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.getElementById('copy-feedback').textContent =
      'Commands selected. Press Ctrl+C or ⌘C to copy.'
  }
})

const copyAgentPrompt = document.getElementById('copy-agent-prompt')
let agentPromptFeedbackTimer = 0
copyAgentPrompt.addEventListener('click', async () => {
  const prompt = document.getElementById('agent-prompt')
  const feedback = document.getElementById('agent-copy-feedback')
  clearTimeout(agentPromptFeedbackTimer)
  try {
    await navigator.clipboard.writeText(prompt.textContent.trim())
    clearTimeout(agentPromptFeedbackTimer)
    copyAgentPrompt.classList.add('is-copied')
    copyAgentPrompt.setAttribute('aria-label', 'Setup prompt copied')
    copyAgentPrompt.title = 'Copied'
    feedback.textContent = 'Ready to paste into your agent.'
    agentPromptFeedbackTimer = setTimeout(() => {
      copyAgentPrompt.classList.remove('is-copied')
      copyAgentPrompt.setAttribute('aria-label', 'Copy setup prompt')
      copyAgentPrompt.title = 'Copy setup prompt'
      feedback.textContent = ''
    }, 3000)
  } catch {
    clearTimeout(agentPromptFeedbackTimer)
    copyAgentPrompt.classList.remove('is-copied')
    copyAgentPrompt.setAttribute('aria-label', 'Copy setup prompt')
    copyAgentPrompt.title = 'Copy setup prompt'
    prompt.focus()
    const range = document.createRange()
    range.selectNodeContents(prompt)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    feedback.textContent = 'Prompt selected. Press Ctrl+C or ⌘C to copy.'
  }
})
