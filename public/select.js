// Theme-owned select popovers. The underlying select remains the source of
// values and change events, so API/form code does not depend on the renderer.
const widgets = new WeakMap()
let opened = null

function position(widget) {
  const rect = widget.button.getBoundingClientRect()
  if (!widget.select.isConnected || !rect.width || widget.select.disabled || rect.bottom < 0 || rect.top > window.innerHeight) return close()
  const width = Math.min(Math.max(rect.width, 140), window.innerWidth - 16)
  widget.menu.style.width = width + 'px'
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const desired = Math.min(widget.menu.scrollHeight + 2, 280)
  const up = below < desired && above > below
  const height = Math.max(34, Math.min(desired, up ? above : below))
  Object.assign(widget.menu.style, {
    width: width + 'px', maxHeight: height + 'px',
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px',
    top: (up ? Math.max(8, rect.top - height - 5) : rect.bottom + 5) + 'px'
  })
}
function highlight(widget, index, scroll = true) {
  if (index < 0) return
  widget.active = index
  widget.options.forEach((option, i) => option.node.classList.toggle('is-active', i === index))
  widget.button.setAttribute('aria-activedescendant', widget.options[index].node.id)
  if (scroll) widget.options[index].node.scrollIntoView({ block: 'nearest' })
}
function close() {
  if (!opened) return
  opened.menu.remove()
  opened.button.setAttribute('aria-expanded', 'false')
  opened.button.removeAttribute('aria-activedescendant')
  opened = null
}
function commit(widget, index) {
  const entry = widget.options[index]
  if (!entry || entry.option.disabled) return
  widget.select.value = entry.option.value
  widget.sync()
  close()
  widget.button.focus({ preventScroll: true })
  widget.select.dispatchEvent(new Event('change', { bubbles: true }))
}
function open(widget) {
  if (widget.select.disabled) return
  close()
  widget.options = []
  widget.menu.replaceChildren()
  Array.from(widget.select.options).forEach((option, index) => {
    if (option.hidden) return
    const node = document.createElement('div')
    node.id = widget.menu.id + '-' + index
    node.className = 'select-option'
    node.setAttribute('role', 'option')
    node.setAttribute('aria-selected', String(option.selected))
    node.setAttribute('aria-disabled', String(option.disabled))
    node.textContent = option.textContent
    const entryIndex = widget.options.length
    node.onpointermove = () => { if (!option.disabled) highlight(widget, entryIndex, false) }
    node.onpointerdown = event => event.preventDefault()
    node.onclick = () => commit(widget, entryIndex)
    widget.options.push({ node, option })
    widget.menu.append(node)
  })
  if (!widget.options.length) return
  document.body.append(widget.menu)
  opened = widget
  widget.button.setAttribute('aria-expanded', 'true')
  position(widget)
  const selected = widget.options.findIndex(entry => entry.option.selected && !entry.option.disabled)
  highlight(widget, selected >= 0 ? selected : widget.options.findIndex(entry => !entry.option.disabled))
}
function move(widget, direction) {
  let index = widget.active
  for (let i = 0; i < widget.options.length; i++) {
    index = (index + direction + widget.options.length) % widget.options.length
    if (!widget.options[index].option.disabled) return highlight(widget, index)
  }
}
function mount(select) {
  if (widgets.has(select)) return
  const shell = document.createElement('div')
  shell.className = 'select-shell'
  shell.dataset.selectId = select.id
  shell.style.width = getComputedStyle(select).width
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'select-trigger'
  button.id = select.id + '-trigger'
  button.setAttribute('role', 'combobox')
  button.setAttribute('aria-haspopup', 'listbox')
  button.setAttribute('aria-expanded', 'false')
  const labels = Array.from(select.labels || [])
  labels.forEach((label, index) => {
    label.id ||= select.id + '-label-' + index
    label.htmlFor = button.id
  })
  if (labels.length) button.setAttribute('aria-labelledby', labels.map(label => label.id).join(' '))
  else button.setAttribute('aria-label', select.getAttribute('aria-label') || select.id)
  const text = document.createElement('span')
  text.className = 'select-text'
  const arrow = document.createElement('span')
  arrow.className = 'select-arrow'
  arrow.setAttribute('aria-hidden', 'true')
  button.append(text, arrow)
  const menu = document.createElement('div')
  menu.className = 'select-menu'
  menu.id = select.id + '-options'
  menu.setAttribute('role', 'listbox')
  menu.setAttribute('aria-label', labels.map(label => label.textContent).join(' ') || button.getAttribute('aria-label'))
  button.setAttribute('aria-controls', menu.id)
  const widget = { select, shell, button, menu, options: [], active: 0 }
  widget.sync = () => {
    text.textContent = select.selectedOptions[0]?.textContent || 'Выберите…'
    button.title = text.textContent
    button.disabled = select.disabled
    if (select.disabled && opened === widget) close()
  }
  widget.observer = new MutationObserver(() => {
    widget.sync()
    // A capability/port refresh may replace the available options.
    if (opened === widget) close()
  })
  select.before(shell)
  select.classList.add('select-source')
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')
  shell.append(select, button)
  button.onclick = () => opened === widget ? close() : open(widget)
  let typed = '', lastTyped = 0
  button.onkeydown = event => {
    const isOpen = opened === widget
    if (event.key === 'Escape') { if (isOpen) { event.preventDefault(); close() }; return }
    if (event.key === 'Tab') { close(); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Enter' || event.key === ' ') return isOpen ? commit(widget, widget.active) : open(widget)
      if (!isOpen) open(widget)
      if (opened !== widget) return
      if (event.key === 'Home') highlight(widget, widget.options.findIndex(entry => !entry.option.disabled))
      else if (event.key === 'End') {
        for (let i = widget.options.length - 1; i >= 0; i--) if (!widget.options[i].option.disabled) { highlight(widget, i); break }
      } else if (isOpen) move(widget, event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = performance.now()
      typed = (now - lastTyped > 600 ? '' : typed) + event.key.toLocaleLowerCase()
      lastTyped = now
      if (!isOpen) open(widget)
      const index = widget.options.findIndex(entry => !entry.option.disabled && entry.option.textContent.toLocaleLowerCase().startsWith(typed))
      if (opened === widget) highlight(widget, index)
    }
  }
  select.addEventListener('change', widget.sync)
  widget.observer.observe(select, { childList: true, subtree: true, attributes: true })
  widgets.set(select, widget)
  widget.sync()
}
export function mountSelects(root = document) { root.querySelectorAll('select').forEach(mount) }
export function releaseSelects(root) {
  root.querySelectorAll('select').forEach(select => {
    const widget = widgets.get(select)
    if (!widget) return
    if (opened === widget) close()
    widget.observer.disconnect()
    select.removeEventListener('change', widget.sync)
    widgets.delete(select)
  })
}
document.addEventListener('pointerdown', event => {
  if (opened && !opened.shell.contains(event.target) && !opened.menu.contains(event.target)) close()
})
document.addEventListener('focusin', event => {
  if (opened && !opened.shell.contains(event.target) && !opened.menu.contains(event.target)) close()
})
window.addEventListener('resize', () => { if (opened) position(opened) })
document.addEventListener('scroll', event => {
  if (opened && !opened.menu.contains(event.target)) position(opened)
}, true)
