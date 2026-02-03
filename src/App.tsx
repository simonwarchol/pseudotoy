import { useEffect, useState, useMemo, useRef } from 'react'
import { Deck } from '@deck.gl/core'
import { OrthographicView } from '@deck.gl/core'
import * as viv from '@hms-dbmi/viv'
import { parse } from '@shaderfrog/glsl-parser'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { cpp } from '@codemirror/lang-cpp'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import CustomShaderExtension, { fragmentShader, defaultMutateColorCode } from './CustomShaderExtension'

const INJECTION_MARKER = '// Injection point:'

/** Decode shader from URL hash (base64url). Returns null if invalid or empty. */
function getShaderFromUrl(): string | null {
  const hash = window.location.hash.slice(1)
  if (!hash) return null
  try {
    const base64 = hash.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Encode shader for URL hash (base64url, no compression). */
function encodeShaderForUrl(shader: string): string {
  const bytes = new TextEncoder().encode(shader)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
}

function parseShader(text: string): { fragmentShader: string; mutateColorCode: string } {
  const idx = text.indexOf(INJECTION_MARKER)
  if (idx === -1) {
    return { fragmentShader: text.trim(), mutateColorCode: defaultMutateColorCode }
  }
  return {
    fragmentShader: text.slice(0, idx).trim(),
    mutateColorCode: text.slice(idx + INJECTION_MARKER.length).trim()
  }
}

function forceContextLoss(canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  if (gl) {
    const ext = gl.getExtension('WEBGL_lose_context')
    ext?.loseContext()
  }
}

function App() {
  const shaderFromUrl = useMemo(() => {
    const s = getShaderFromUrl()
    if (!s) {
      // Invalid/corrupt hash → redirect to default
      const encoded = encodeShaderForUrl(fragmentShader)
      window.location.replace(`${window.location.origin}${window.location.pathname}${window.location.search}#${encoded}`)
      return null
    }
    return s
  }, [])
  const [data, setData] = useState<Awaited<ReturnType<typeof viv.loadOmeTiff>>['data'] | null>(null)
  const [shaderText, setShaderText] = useState(shaderFromUrl ?? '')
  const [appliedShader] = useState(shaderFromUrl ?? '')
  const [compileError, setCompileError] = useState<string | null>(null)
  const [viewState, setViewState] = useState({ target: [1750, 1250, 0] as [number, number, number], zoom: -2 })
  const baselineContainerRef = useRef<HTMLDivElement>(null)
  const customContainerRef = useRef<HTMLDivElement>(null)
  const baselineDeckRef = useRef<Deck<OrthographicView> | null>(null)
  const customDeckRef = useRef<Deck<OrthographicView> | null>(null)
  const baselineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const customCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const extensions = useMemo(() => [cpp(), EditorView.lineWrapping], [])

  // Only render main UI when we have a valid shader from URL (main.tsx redirects / to default; invalid hash redirects here)
  if (!shaderFromUrl) {
    return <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', color: '#888' }}>Loading…</div>
  }

  function handleCompile() {
    setCompileError(null)
    const { fragmentShader: fs } = parseShader(shaderText)
    try {
      parse(fs, { stage: 'fragment', grammarSource: 'shader.glsl' })
      const encoded = encodeShaderForUrl(shaderText)
      window.location.hash = encoded
      window.location.reload()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setCompileError(message)
    }
  }

  function handleCopyLink() {
    const encoded = encodeShaderForUrl(shaderText)
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#${encoded}`
    navigator.clipboard.writeText(url)
  }

  useEffect(() => {
    viv.loadOmeTiff('https://lsp-public-data.s3.us-east-1.amazonaws.com/tonsil.ome.tif')
      .then(({ data }) => setData(data))
  }, [])

  const handleViewStateChange = ({ viewState: vs }: { viewState: { target?: number[]; zoom?: number | [number, number] } }) => {
    if (vs.target) {
      const zoom = Array.isArray(vs.zoom) ? vs.zoom[0] : vs.zoom
      if (typeof zoom === 'number') {
        setViewState({
          target: vs.target as [number, number, number],
          zoom
        })
      }
    }
  }

  useEffect(() => {
    if (!data || !baselineContainerRef.current || !customContainerRef.current) return

    const baselineLayer = new viv.MultiscaleImageLayer({
      id: 'baseline-image',
      loader: data,
      selections: [{ c: 0, t: 0, z: 0 }],
      channelsVisible: [true],
      contrastLimits: [[0, 65535]],
      dtype: 'Uint16',
      extensions: [new CustomShaderExtension()]
    } as any)

    const { fragmentShader: fs, mutateColorCode } = parseShader(appliedShader)
    const customLayer = new viv.MultiscaleImageLayer({
      id: `custom-image-${appliedShader.length}-${Date.now()}`,
      loader: data,
      selections: [{ c: 0, t: 0, z: 0 }],
      channelsVisible: [true],
      contrastLimits: [[0, 65535]],
      dtype: 'Uint16',
      extensions: [new CustomShaderExtension()],
      fragmentShader: fs,
      mutateColorCode
    } as any)

    const createDeck = (
      container: HTMLDivElement,
      layers: InstanceType<typeof viv.MultiscaleImageLayer>[],
      deckRef: React.MutableRefObject<Deck<OrthographicView> | null>,
      canvasRef: React.MutableRefObject<HTMLCanvasElement | null>
    ) => {
      if (deckRef.current) {
        const oldCanvas = deckRef.current.getCanvas?.() ?? canvasRef.current
        forceContextLoss(oldCanvas)
        deckRef.current.finalize()
        deckRef.current = null
      }
      if (canvasRef.current?.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current)
        canvasRef.current = null
      }
      const canvas = document.createElement('canvas')
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      container.appendChild(canvas)
      canvasRef.current = canvas
      const deck = new Deck<OrthographicView>({
        canvas,
        views: new OrthographicView(),
        initialViewState: viewState,
        controller: true,
        onViewStateChange: handleViewStateChange,
        layers
      })
      deckRef.current = deck
    }

    createDeck(baselineContainerRef.current, [baselineLayer], baselineDeckRef, baselineCanvasRef)
    createDeck(customContainerRef.current, [customLayer], customDeckRef, customCanvasRef)

    return () => {
      ;[baselineDeckRef, customDeckRef].forEach((ref) => {
        if (ref.current) {
          ref.current.finalize()
          ref.current = null
        }
      })
      ;[baselineCanvasRef, customCanvasRef].forEach((ref) => {
        forceContextLoss(ref.current)
        if (ref.current?.parentNode) {
          ref.current.parentNode.removeChild(ref.current)
          ref.current = null
        }
      })
    }
  }, [data, appliedShader])

  useEffect(() => {
    if (baselineDeckRef.current) baselineDeckRef.current.setProps({ viewState })
    if (customDeckRef.current) customDeckRef.current.setProps({ viewState })
  }, [viewState])

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      overflow: 'hidden',
      flexDirection: 'column',
      position: 'relative'
    }}>
      <div style={{
        padding: '12px 20px',
        fontSize: '20px',
        fontWeight: 600,
        color: '#fff',
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #333',
        fontFamily: 'sans-serif',
        textAlign: 'center'
      }}>
        pseudotoy
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      <div style={{
        width: '50%',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        borderRight: '1px solid #333',
        fontFamily: 'sans-serif'
      }}>
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #333'
        }}>
          <h3 style={{ margin: 0, color: '#fff', fontFamily: 'sans-serif' }}>Fragment Shader</h3>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', width: '100%' }}>
          <CodeMirror
            value={shaderText}
            onChange={setShaderText}
            theme={vscodeDark}
            extensions={extensions}
            basicSetup={{ lineNumbers: true }}
            height="100%"
            width="100%"
          />
        </div>
        {compileError && (
          <pre style={{
            margin: 0,
            padding: '12px 16px',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#f48771',
            backgroundColor: '#2d2020',
            borderTop: '1px solid #333',
            overflow: 'auto',
            maxHeight: '120px'
          }}>{compileError}</pre>
        )}
        <div style={{ display: 'flex', gap: '8px', margin: '16px' }}>
          <button
            onClick={handleCompile}
            style={{
              padding: '10px 16px',
              backgroundColor: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            Compile
          </button>
          <button
            onClick={handleCopyLink}
            style={{
              padding: '10px 16px',
              backgroundColor: '#333',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            Copy link
          </button>
        </div>
      </div>
      <div style={{
        width: '50%',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#1a1a1a'
      }}>
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid #333'
        }}>
          <div style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            color: '#888',
            backgroundColor: '#252525',
            borderBottom: '1px solid #333',
            fontFamily: 'sans-serif'
          }}>
            sRGB baseline
          </div>
          <div
            ref={baselineContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflow: 'hidden'
            }}
          />
        </div>
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            color: '#888',
            backgroundColor: '#252525',
            borderBottom: '1px solid #333',
            fontFamily: 'sans-serif'
          }}>
            Custom shader
          </div>
          <div
            ref={customContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflow: 'hidden'
            }}
          />
        </div>
      </div>
      </div>
    </div>
  )
}

export default App
