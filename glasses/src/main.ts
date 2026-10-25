import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
  AudioInputSource,
} from '@evenrealities/even_hub_sdk'
import { connectServer } from './server'

// Explicit server URL for local dev; otherwise the app is served by the server itself (e.g. through a tunnel).
const SERVER_URL = ((import.meta.env.VITE_SERVER_URL as string | undefined) || location.origin).replace(/\/$/, '')
const statusEl = document.getElementById('app')!

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

async function main() {
  const bridge = await waitForEvenAppBridge()

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 8,
          containerID: 1,
          containerName: 'main',
          content: SERVER_URL ? 'Connecting...' : 'No server URL set.\nAdd VITE_SERVER_URL to glasses/.env',
          isEventCapture: 1,
        }),
      ],
    }),
  )
  if (result !== 0) statusEl.textContent = `Display setup failed (${result})`
  // Clear any mic session left open by a previous page load.
  await bridge.audioControl(false)

  const show = (content: string) => {
    statusEl.textContent = content
    bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: content.slice(0, 1900) }))
  }
  if (!SERVER_URL) return

  let micOn = false
  const setMic = async (on: boolean) => {
    if (on === micOn) return
    micOn = on
    // Docs: start takes a source; stop is called with no source.
    if (on) await bridge.audioControl(true, AudioInputSource.Glasses)
    else await bridge.audioControl(false)
  }

  let phase = 'idle'
  const server = connectServer(SERVER_URL, (event) => {
    if (typeof event.glasses === 'string') show(event.glasses)
    else if (event.type === 'result' && typeof event.message === 'string') show(event.message)
    else if (event.type === 'error' && typeof event.message === 'string') show(`Error: ${event.message.slice(0, 120)}`)
    if (typeof event.phase === 'string') {
      phase = event.phase
      void setMic(phase === 'listening')
    }
  }, (mode) => {
    if (phase === 'idle') show(`Connected (${mode}).\nTap to start listening`)
  })

  bridge.onEvenHubEvent((event) => {
    const audio = event.audioEvent
    if (audio?.audioPcm) {
      server.sendAudio(audio.audioPcm)
      return
    }

    const sysType = eventTypeOf(event.sysEvent)
    const textType = eventTypeOf(event.textEvent)
    const is = (t: OsEventTypeList) => sysType === t || textType === t

    if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
      void setMic(false)
      bridge.shutDownPageContainer(1)
      return
    }
    if (is(OsEventTypeList.SCROLL_TOP_EVENT) || is(OsEventTypeList.SCROLL_BOTTOM_EVENT)) {
      if (phase === 'awaiting_approval') server.control({ type: 'reject' })
      return
    }
    if (is(OsEventTypeList.CLICK_EVENT)) server.control({ type: 'tap' })
  })
}

main().catch((err) => {
  statusEl.textContent = `Startup error: ${err instanceof Error ? err.message : String(err)}`
})
