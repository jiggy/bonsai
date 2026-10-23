;(() => {
  'use strict'

  const section = document.getElementById('get-started')
  if (!section) return

  const tabs = [...section.querySelectorAll('.setup-tabs [role="tab"]')]
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')))
  if (!tabs.length || panels.some((panel) => !panel || !section.contains(panel))) return

  function selectSetup(tab, moveFocus = false) {
    tabs.forEach((item, index) => {
      const selected = item === tab
      item.setAttribute('aria-selected', String(selected))
      item.tabIndex = selected ? 0 : -1
      panels[index].hidden = !selected
      panels[index].setAttribute('role', 'tabpanel')
      panels[index].setAttribute('aria-labelledby', item.id)
    })
    if (moveFocus) tab.focus()
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectSetup(tab))
    tab.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      let destination
      if (event.key === 'ArrowRight') destination = (index + 1) % tabs.length
      else if (event.key === 'ArrowLeft') destination = (index + tabs.length - 1) % tabs.length
      else if (event.key === 'Home') destination = 0
      else if (event.key === 'End') destination = tabs.length - 1
      else return

      event.preventDefault()
      selectSetup(tabs[destination], true)
    })
  })

  selectSetup(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0])
})()
