import { mountSelects, releaseSelects } from './select.js'
const $ = s => document.querySelector(s)
let config, inputs = [], signature = '', connected = false, streamLive = false, meSignature = ''
function notice(message, error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error) }
async function api(url, data, method = 'GET') {
  const res = await fetch(url, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined })
  const value = await res.json()
  if (!res.ok) throw new Error(value.error || 'Ошибка запроса')
  return value
}
async function action(button, fn) {
  button.disabled = true
  try { await fn() } catch (e) { notice(e.message, true) }
  finally { if (button.id !== 'atem-me') button.disabled = button.classList.contains('test-key') && !connected }
}
async function save(patch) {
  config = await api('/api/config', patch, 'PATCH')
  notice('Сохранено и применено')
}
function option(value, text) { const o = document.createElement('option'); o.value = value; o.textContent = text; return o }
async function loadPorts() {
  const selected = $('#com-port').value || config.comPort
  const ports = await api('/api/ports')
  $('#com-port').replaceChildren(option('auto', 'Автоматически · AVMATRIX / CH340'))
  for (const p of ports) $('#com-port').append(option(p.path, p.path + ' · ' + (p.manufacturer || 'USB Serial')))
  if (selected !== 'auto' && !ports.some(p => p.path === selected)) $('#com-port').append(option(selected, selected + ' · сейчас отсутствует'))
  $('#com-port').value = selected
}
function mapping(focusId) {
  const list = $('#mapping-list')
  const focused = focusId || document.activeElement?.closest('.select-shell')?.dataset.selectId
  releaseSelects(list)
  list.replaceChildren()
  for (const l of config.lamps) {
    const row = document.createElement('div'); row.className = 'mapping-row'
    const label = document.createElement('label'); label.textContent = 'Tally ' + l.id; label.htmlFor = 'map-' + l.id
    const select = document.createElement('select'); select.id = label.htmlFor
    select.append(option(0, 'Не назначено'))
    for (const input of inputs) select.append(option(input.id, input.id + ' · ' + input.name))
    if (l.atemInput && !inputs.some(i => i.id === l.atemInput)) select.append(option(l.atemInput, 'Вход ' + l.atemInput + ' · сохранённый'))
    select.value = l.atemInput
    select.onchange = () => action(select, async () => {
      try { await save({ lamps: config.lamps.map(item => ({ id: item.id, atemInput: item.id === l.id ? Number(select.value) : item.atemInput })) }) }
      finally { mapping(select.id) }
    })
    row.append(label, select); list.append(row)
  }
  mountSelects(list)
  if (focused) document.getElementById(focused + '-trigger')?.focus({ preventScroll: true })
}
function tests() {
  const list = $('#test-list')
  list.replaceChildren()
  for (const [color, name] of [['program', 'Program'], ['preview', 'Preview']]) {
    const title = document.createElement('div')
    title.className = 'bus-label test-label'
    title.textContent = name
    const bank = document.createElement('div')
    bank.className = 'key-bank'
    for (const lamp of config.lamps) {
      const button = document.createElement('button')
      button.textContent = 'TALLY ' + lamp.id
      button.className = 'test-key'
      button.dataset.id = lamp.id
      button.dataset.color = color
      button.setAttribute('aria-label', 'Тест ' + color + ' — Tally ' + lamp.id)
      button.disabled = !connected
      button.onclick = () => action(button, () => api('/api/test/lamp/' + lamp.id + '?color=' + color, {}, 'POST'))
      bank.append(button)
    }
    list.append(title, bank)
  }
}
function sourceName(lamp, sources) {
  return lamp.atemInput === 0 ? 'Не назначено' : sources.find(input => input.id === lamp.atemInput)?.name || 'Вход ' + lamp.atemInput
}
function renderBank(selector, lamps, sources, signal) {
  $(selector).replaceChildren(...lamps.map(lamp => {
    const key = document.createElement('div')
    const active = lamp[signal]
    key.className = 'tally-key' + (active ? ' ' + signal : '') + (active && lamp.testing ? ' testing' : '')
    key.setAttribute('role', 'img')
    key.setAttribute('aria-label', 'Tally ' + lamp.id + ' · ' + sourceName(lamp, sources) + ' · ' + (active ? signal : 'выключено'))
    const title = document.createElement('strong')
    title.textContent = 'TALLY ' + lamp.id
    const source = document.createElement('span')
    source.textContent = sourceName(lamp, sources)
    key.append(title, source)
    return key
  }))
}
function renderMixEffects(connections) {
  const list = connections.mixEffects || []
  const selected = connections.atemMe || config?.atem.me || 1
  const select = $('#atem-me')
  const signature = JSON.stringify([list, selected])
  if (signature !== meSignature || Number(select.value) !== selected) {
    meSignature = signature
    select.replaceChildren(...list.map(bank => option(bank.id, bank.name)))
    if (!list.some(bank => bank.id === selected)) select.append(option(selected, 'M/E ' + selected + (connections.atem ? ' · недоступен' : '')))
    select.value = selected
  }
  select.disabled = !connections.atem || !list.length
  $('#atem-me-status').textContent = list.some(bank => bank.id === selected) ? 'Tally · M/E ' + selected : connections.atem ? 'Выберите доступный M/E' : ''
}
function status(data) {
  const c = data.connections
  connected = !!c.com
  $('#atem-dot').classList.toggle('on', !!c.atem)
  $('#com-dot').classList.toggle('on', connected)
  $('#atem-status').textContent = c.atem ? (c.atemName || 'Подключён') + ' · ' + c.atemIp : 'Не подключён'
  const states = { searching: 'Поиск устройства…', connecting: 'Подключение…', 'selection-required': 'Найдено несколько устройств — выберите COM-порт', disconnected: 'Не подключён' }
  $('#com-status').textContent = connected ? c.serial.port + ' · порт открыт' : c.serial.error || states[c.serial.state] || 'Поиск…'
  const sources = data.inputs || []
  renderBank('#program-lamps', data.lamps, sources, 'program')
  renderBank('#preview-lamps', data.lamps, sources, 'preview')
  renderMixEffects(c)
  document.querySelectorAll('.test-key').forEach(button => {
    button.disabled = !connected
    const lamp = data.lamps.find(l => l.id === Number(button.dataset.id))
    const active = !!lamp?.testing && lamp[button.dataset.color]
    button.classList.toggle(button.dataset.color, active)
  })
  const next = JSON.stringify(sources)
  if (next !== signature) {
    signature = next
    inputs = sources
    if (config) mapping()
  }
}
document.querySelectorAll('.tab').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active) })
    document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== button.dataset.tab })
  }
})
$('#atem-form').onsubmit = e => { e.preventDefault(); action(e.submitter, () => save({ atem: { ip: $('#atem-ip').value.trim(), enabled: true } })) }
$('#serial-form').onsubmit = e => { e.preventDefault(); action(e.submitter, () => save({ comPort: $('#com-port').value, baudRate: Number($('#baud-rate').value) })) }
$('#disconnect').onchange = () => action($('#disconnect'), () => save({ onAtemDisconnect: $('#disconnect').value }))
$('#refresh-ports').onclick = () => action($('#refresh-ports'), loadPorts)
$('#atem-me').onchange = () => action($('#atem-me'), async () => {
  try { await save({ atem: { me: Number($('#atem-me').value) } }) }
  finally { status(await api('/status')) }
})
$('#scan').onclick = () => action($('#scan'), async () => {
  notice('Поиск ATEM в локальной сети…')
  const found = await api('/api/atem/scan'); $('#devices').replaceChildren()
  for (const device of found) {
    const row = document.createElement('div'); row.className = 'device'
    const label = document.createElement('span'); label.textContent = (device.name || 'ATEM') + ' · ' + device.ip
    const button = document.createElement('button'); button.textContent = 'Подключить'
    button.onclick = () => action(button, async () => { await save({ atem: { ip: device.ip, enabled: true } }); $('#atem-ip').value = device.ip })
    row.append(label, button); $('#devices').append(row)
  }
  notice(found.length ? 'Выберите нужный пульт' : 'Пульты не найдены. Можно указать IP вручную.')
})
async function boot() {
  config = await api('/api/config')
  $('#atem-ip').value = config.atem.ip; $('#baud-rate').value = config.baudRate; $('#disconnect').value = config.onAtemDisconnect
  $('#com-port').value = config.comPort; await loadPorts()
  mapping(); tests(); mountSelects()
  const es = new EventSource('/events')
  es.onmessage = e => { status(JSON.parse(e.data)); if (!streamLive) notice('Связь с сервером установлена'); streamLive = true }
  es.onerror = () => {
    streamLive = false; connected = false; $('#atem-status').textContent = 'Нет связи с сервером'; $('#com-status').textContent = 'Нет связи с сервером'
    $('#atem-dot').classList.remove('on'); $('#com-dot').classList.remove('on')
    document.querySelectorAll('#test-list button').forEach(b => { b.disabled = true })
    notice('Связь с сервером потеряна. Переподключение…', true)
  }
}
boot().catch(e => notice(e.message, true))
