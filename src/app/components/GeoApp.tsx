'use client'

import { useReducer, useRef, useEffect, useCallback, useState } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Bin {
  id: number
  x: number
  y: number
  saturation: number  // S(t): 0–100
  congestion: number  // P(t): 0–1
}

interface AppState {
  bins: Bin[]
  truckPos: { x: number; y: number } | null
  alpha: number
  beta: number
  mode: 'addBin' | 'setTruck' | 'view'
  selectedBinId: number | null
  nextId: number
}

type Action =
  | { type: 'ADD_BIN'; bin: Bin }
  | { type: 'SET_TRUCK'; x: number; y: number }
  | { type: 'SET_ALPHA'; value: number }
  | { type: 'SET_BETA'; value: number }
  | { type: 'SET_MODE'; mode: AppState['mode'] }
  | { type: 'SELECT_BIN'; id: number | null }
  | { type: 'UPDATE_BIN'; id: number; saturation: number; congestion: number }
  | { type: 'DELETE_BIN'; id: number }
  | { type: 'RESET' }

// ─── Reducer ─────────────────────────────────────────────────────────────────

const initialState: AppState = {
  bins: [],
  truckPos: null,
  alpha: 1.0,
  beta: 0.5,
  mode: 'addBin',
  selectedBinId: null,
  nextId: 1,
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_BIN':
      return { ...state, bins: [...state.bins, action.bin], nextId: state.nextId + 1 }
    case 'SET_TRUCK':
      return { ...state, truckPos: { x: action.x, y: action.y } }
    case 'SET_ALPHA':
      return { ...state, alpha: action.value }
    case 'SET_BETA':
      return { ...state, beta: action.value }
    case 'SET_MODE':
      return { ...state, mode: action.mode }
    case 'SELECT_BIN':
      return { ...state, selectedBinId: action.id }
    case 'UPDATE_BIN':
      return {
        ...state,
        bins: state.bins.map(b =>
          b.id === action.id
            ? { ...b, saturation: action.saturation, congestion: action.congestion }
            : b
        ),
      }
    case 'DELETE_BIN':
      return {
        ...state,
        bins: state.bins.filter(b => b.id !== action.id),
        selectedBinId: state.selectedBinId === action.id ? null : state.selectedBinId,
      }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

// ─── Algorithm ───────────────────────────────────────────────────────────────

function euclidDist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

interface RouteStep {
  binId: number
  u: number
  fpull: number
  fpush: number
  stepDist: number
}

function computeRoute(
  bins: Bin[],
  truckPos: { x: number; y: number },
  alpha: number,
  beta: number
): RouteStep[] {
  const remaining = [...bins]
  let cx = truckPos.x
  let cy = truckPos.y
  const route: RouteStep[] = []

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestU = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const r = Math.max(euclidDist(cx, cy, remaining[i].x, remaining[i].y), 1)
      const fpull = alpha * remaining[i].saturation / (r * r)
      const fpush = beta * remaining[i].congestion
      const u = fpull - fpush
      if (u > bestU) {
        bestU = u
        bestIdx = i
      }
    }

    const b = remaining[bestIdx]
    const d = euclidDist(cx, cy, b.x, b.y)
    const fpull = alpha * b.saturation / Math.max(d * d, 1)
    const fpush = beta * b.congestion
    route.push({ binId: b.id, u: fpull - fpush, fpull, fpush, stepDist: d })
    cx = b.x
    cy = b.y
    remaining.splice(bestIdx, 1)
  }

  return route
}

// ─── Canvas constants & helpers ───────────────────────────────────────────────

const CANVAS_W = 820
const CANVAS_H = 520
const GRID = 40
const BIN_R = 14

function satColor(s: number): string {
  if (s <= 50) {
    const t = s / 50
    return `rgb(${Math.round(t * 255)},${Math.round(180 + t * 20)},0)`
  }
  const t = (s - 50) / 50
  return `rgb(255,${Math.round((1 - t) * 200)},0)`
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fx: number, fy: number,
  tx: number, ty: number
) {
  const angle = Math.atan2(ty - fy, tx - fx)
  const len = 11
  const ex = tx - Math.cos(angle) * (BIN_R + 2)
  const ey = ty - Math.sin(angle) * (BIN_R + 2)
  ctx.setLineDash([])
  ctx.fillStyle = '#818cf8'
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - len * Math.cos(angle - 0.42), ey - len * Math.sin(angle - 0.42))
  ctx.lineTo(ex - len * Math.cos(angle + 0.42), ey - len * Math.sin(angle + 0.42))
  ctx.closePath()
  ctx.fill()
  ctx.setLineDash([6, 4])
}

function drawTruck(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Body
  ctx.fillStyle = '#1d4ed8'
  ctx.beginPath()
  ctx.roundRect(x - 20, y - 10, 40, 20, 4)
  ctx.fill()
  // Cab
  ctx.fillStyle = '#3b82f6'
  ctx.beginPath()
  ctx.roundRect(x + 12, y - 17, 12, 14, 3)
  ctx.fill()
  // Window
  ctx.fillStyle = '#bfdbfe'
  ctx.fillRect(x + 13, y - 16, 10, 6)
  // Wheels
  for (const wx of [x - 10, x + 9]) {
    ctx.beginPath()
    ctx.arc(wx, y + 10, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#111827'
    ctx.fill()
    ctx.strokeStyle = '#4b5563'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  // Label
  ctx.fillStyle = '#e0e7ff'
  ctx.font = 'bold 8px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('TRUCK', x - 3, y)
}

// ─── SliderRow ────────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  valueClass: string
  accentClass: string
  onChange: (v: number) => void
}

function SliderRow({ label, value, min, max, step, display, valueClass, accentClass, onChange }: SliderRowProps) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-gray-400">{label}</span>
        <span className={valueClass}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className={`w-full h-1.5 rounded-full ${accentClass}`}
      />
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GeoApp() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number | null>(null)

  const [newS, setNewS] = useState(70)
  const [newP, setNewP] = useState(0.3)
  const [simStep, setSimStep] = useState(-1)
  const [animPos, setAnimPos] = useState<{ x: number; y: number } | null>(null)

  const selectedBin = state.bins.find(b => b.id === state.selectedBinId) ?? null

  const route =
    state.truckPos && state.bins.length > 0
      ? computeRoute(state.bins, state.truckPos, state.alpha, state.beta)
      : []

  const totalDist = route.reduce((s, r) => s + r.stepDist, 0)
  const isSimulating = simStep >= 0

  // ── Canvas draw ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Background
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 0.5
    for (let gx = 0; gx <= CANVAS_W; gx += GRID) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, CANVAS_H); ctx.stroke()
    }
    for (let gy = 0; gy <= CANVAS_H; gy += GRID) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CANVAS_W, gy); ctx.stroke()
    }

    // Route lines + arrows
    if (route.length > 0 && state.truckPos) {
      const waypoints = [
        state.truckPos,
        ...route.map(r => state.bins.find(b => b.id === r.binId)!),
      ]
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(129,140,248,0.65)'
      ctx.lineWidth = 2

      for (let i = 0; i < waypoints.length - 1; i++) {
        ctx.beginPath()
        ctx.moveTo(waypoints[i].x, waypoints[i].y)
        ctx.lineTo(waypoints[i + 1].x, waypoints[i + 1].y)
        ctx.stroke()
        drawArrowHead(ctx, waypoints[i].x, waypoints[i].y, waypoints[i + 1].x, waypoints[i + 1].y)
      }
      ctx.setLineDash([])
    }

    // Bins
    for (const bin of state.bins) {
      const isSelected = bin.id === state.selectedBinId
      const routeIdx = route.findIndex(r => r.binId === bin.id)

      if (isSelected) {
        ctx.beginPath()
        ctx.arc(bin.x, bin.y, BIN_R + 5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(99,102,241,0.35)'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(bin.x, bin.y, BIN_R, 0, Math.PI * 2)
      ctx.fillStyle = satColor(bin.saturation)
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#818cf8' : 'rgba(255,255,255,0.25)'
      ctx.lineWidth = isSelected ? 2.5 : 1.5
      ctx.stroke()

      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`#${bin.id}`, bin.x, bin.y)

      if (routeIdx >= 0) {
        ctx.beginPath()
        ctx.arc(bin.x + BIN_R, bin.y - BIN_R, 9, 0, Math.PI * 2)
        ctx.fillStyle = '#4f46e5'
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 8px sans-serif'
        ctx.fillText(String(routeIdx + 1), bin.x + BIN_R, bin.y - BIN_R)
      }

      // Saturation mini-bar below bin
      const bw = 28
      const bx = bin.x - bw / 2
      const by = bin.y + BIN_R + 4
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(bx, by, bw, 3)
      ctx.fillStyle = satColor(bin.saturation)
      ctx.fillRect(bx, by, bw * (bin.saturation / 100), 3)
    }

    // Truck
    const tx = animPos ? animPos.x : state.truckPos?.x
    const ty = animPos ? animPos.y : state.truckPos?.y
    if (tx !== undefined && ty !== undefined && tx !== null && ty !== null) {
      drawTruck(ctx, tx, ty)
    }

    // Hint text when empty
    if (state.bins.length === 0 && !state.truckPos) {
      ctx.fillStyle = 'rgba(156,163,175,0.4)'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('캔버스를 클릭하여 쓰레기통을 배치하세요', CANVAS_W / 2, CANVAS_H / 2)
    }
  }, [state, route, animPos])

  // ── Canvas click ─────────────────────────────────────────────────────────────

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (state.mode === 'addBin') {
        const hit = state.bins.find(b => euclidDist(b.x, b.y, x, y) < BIN_R + 6)
        if (hit) {
          dispatch({ type: 'SELECT_BIN', id: hit.id })
          return
        }
        dispatch({
          type: 'ADD_BIN',
          bin: { id: state.nextId, x, y, saturation: newS, congestion: newP },
        })
      } else if (state.mode === 'setTruck') {
        dispatch({ type: 'SET_TRUCK', x, y })
      } else {
        const hit = state.bins.find(b => euclidDist(b.x, b.y, x, y) < BIN_R + 6)
        dispatch({ type: 'SELECT_BIN', id: hit?.id ?? null })
      }
    },
    [state.mode, state.bins, state.nextId, newS, newP]
  )

  // ── Simulation ────────────────────────────────────────────────────────────────

  const startSim = useCallback(() => {
    if (!state.truckPos || route.length === 0) return
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)

    const waypoints: { x: number; y: number }[] = [
      state.truckPos,
      ...route.map(r => state.bins.find(b => b.id === r.binId)!),
    ]

    let seg = 0
    let t = 0
    const SPEED = 0.016

    const tick = () => {
      t += SPEED
      if (t >= 1) {
        seg++
        t = 0
        if (seg >= waypoints.length - 1) {
          setSimStep(-1)
          setAnimPos(null)
          return
        }
        setSimStep(seg)
      }
      const from = waypoints[seg]
      const to = waypoints[seg + 1]
      setAnimPos({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      })
      animFrameRef.current = requestAnimationFrame(tick)
    }

    setSimStep(0)
    setAnimPos({ x: state.truckPos.x, y: state.truckPos.y })
    animFrameRef.current = requestAnimationFrame(tick)
  }, [state.truckPos, state.bins, route])

  const stopSim = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    setSimStep(-1)
    setAnimPos(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="text-xl">🚛</span>
        <div>
          <h1 className="text-sm font-bold text-indigo-400 leading-tight">
            분리수거 트럭 최적 경로 시스템
          </h1>
          <p className="text-[10px] text-gray-500">
            매력도 기반 Greedy 경로 탐색 · Geo Tech Project
          </p>
        </div>
        <div className="ml-auto flex items-center gap-5 text-xs text-gray-500">
          <span>
            통 수: <span className="text-white font-medium">{state.bins.length}</span>
          </span>
          {state.truckPos && (
            <span className="text-green-500 text-[11px]">✔ 트럭 출발점 설정됨</span>
          )}
          {route.length > 0 && (
            <span>
              총 거리:{' '}
              <span className="text-indigo-300 font-medium">{totalDist.toFixed(0)} px</span>
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Left Panel ── */}
        <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col overflow-y-auto shrink-0">
          <div className="p-3 space-y-4">

            {/* Mode selection */}
            <section>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                모드 선택
              </p>
              <div className="space-y-1">
                {(
                  [
                    ['addBin', '🗑️', '쓰레기통 배치'],
                    ['setTruck', '🚛', '트럭 출발점'],
                    ['view', '👁️', '선택 / 보기'],
                  ] as const
                ).map(([m, icon, label]) => (
                  <button
                    key={m}
                    onClick={() => dispatch({ type: 'SET_MODE', mode: m })}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                      state.mode === m
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </section>

            {/* New bin defaults */}
            {state.mode === 'addBin' && (
              <section>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                  새 쓰레기통 기본값
                </p>
                <div className="space-y-2">
                  <SliderRow
                    label="포화도 S(t)"
                    value={newS} min={0} max={100} step={1}
                    display={`${newS}%`}
                    valueClass="text-yellow-400"
                    accentClass="accent-yellow-400"
                    onChange={setNewS}
                  />
                  <SliderRow
                    label="혼잡도 P(t)"
                    value={newP} min={0} max={1} step={0.01}
                    display={newP.toFixed(2)}
                    valueClass="text-orange-400"
                    accentClass="accent-orange-400"
                    onChange={setNewP}
                  />
                </div>
              </section>
            )}

            {/* Selected bin editor */}
            {selectedBin && (
              <section className="border border-indigo-700 rounded-lg p-2.5">
                <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest mb-2">
                  선택된 통 #{selectedBin.id}
                </p>
                <div className="space-y-2">
                  <SliderRow
                    label="포화도 S(t)"
                    value={selectedBin.saturation} min={0} max={100} step={1}
                    display={`${selectedBin.saturation}%`}
                    valueClass="text-yellow-400"
                    accentClass="accent-yellow-400"
                    onChange={v =>
                      dispatch({
                        type: 'UPDATE_BIN',
                        id: selectedBin.id,
                        saturation: v,
                        congestion: selectedBin.congestion,
                      })
                    }
                  />
                  <SliderRow
                    label="혼잡도 P(t)"
                    value={selectedBin.congestion} min={0} max={1} step={0.01}
                    display={selectedBin.congestion.toFixed(2)}
                    valueClass="text-orange-400"
                    accentClass="accent-orange-400"
                    onChange={v =>
                      dispatch({
                        type: 'UPDATE_BIN',
                        id: selectedBin.id,
                        saturation: selectedBin.saturation,
                        congestion: v,
                      })
                    }
                  />
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mt-1">
                    <div>
                      F_pull:{' '}
                      <span className="text-blue-400">
                        {(
                          state.alpha *
                          selectedBin.saturation /
                          Math.max(
                            route.find(r => r.binId === selectedBin.id)?.stepDist ?? 1,
                            1
                          ) ** 2
                        ).toFixed(4)}
                      </span>
                    </div>
                    <div>
                      F_push:{' '}
                      <span className="text-red-400">
                        {(state.beta * selectedBin.congestion).toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => dispatch({ type: 'DELETE_BIN', id: selectedBin.id })}
                    className="w-full py-1 bg-red-900 hover:bg-red-700 text-red-200 text-xs rounded transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </section>
            )}

            {/* Alpha / Beta */}
            <section>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                가중치 파라미터
              </p>
              <div className="space-y-2">
                <SliderRow
                  label="α (유인력 가중치)"
                  value={state.alpha} min={0} max={5} step={0.1}
                  display={state.alpha.toFixed(1)}
                  valueClass="text-green-400"
                  accentClass="accent-green-500"
                  onChange={v => dispatch({ type: 'SET_ALPHA', value: v })}
                />
                <SliderRow
                  label="β (반발력 가중치)"
                  value={state.beta} min={0} max={5} step={0.1}
                  display={state.beta.toFixed(1)}
                  valueClass="text-red-400"
                  accentClass="accent-red-500"
                  onChange={v => dispatch({ type: 'SET_BETA', value: v })}
                />
              </div>
            </section>

            {/* Formula */}
            <section className="bg-gray-800 rounded-lg p-2.5 text-[10px] text-gray-400 space-y-1">
              <p className="font-semibold text-gray-300">매력도 공식</p>
              <p>F_pull = α × S(t) / r²</p>
              <p>F_push = β × P(t)</p>
              <p className="text-indigo-300 font-semibold">U(t) = F_pull − F_push</p>
              <p className="text-gray-500 mt-1">r: 트럭→쓰레기통 거리(px)</p>
            </section>

            {/* Legend */}
            <section>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
                범례
              </p>
              <div className="space-y-1.5 text-[11px]">
                {[
                  ['bg-green-500', '낮은 포화도 (0–33%)'],
                  ['bg-yellow-400', '중간 포화도 (34–66%)'],
                  ['bg-red-500', '높은 포화도 (67–100%)'],
                  ['bg-blue-600', '트럭 위치'],
                ].map(([cls, label]) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${cls}`} />
                    <span className="text-gray-400">{label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <div className="w-6 border-t-2 border-dashed border-indigo-400 shrink-0" />
                  <span className="text-gray-400">방문 경로 (화살표)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0 bg-indigo-500" />
                  <span className="text-gray-400">방문 순서 뱃지</span>
                </div>
              </div>
            </section>

            {/* Actions */}
            <section className="space-y-1.5">
              <button
                onClick={isSimulating ? stopSim : startSim}
                disabled={!state.truckPos || state.bins.length === 0}
                className="w-full py-2 rounded text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                {isSimulating ? '⏹ 중지' : '▶ 시뮬레이션 시작'}
              </button>
              <button
                onClick={() => {
                  stopSim()
                  dispatch({ type: 'RESET' })
                }}
                className="w-full py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                초기화
              </button>
            </section>
          </div>
        </aside>

        {/* ── Canvas + Table ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Canvas area */}
          <div className="flex-1 flex items-center justify-center bg-gray-950 overflow-auto p-3">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onClick={handleCanvasClick}
              className={`rounded-xl border border-gray-800 shadow-2xl ${
                state.mode === 'addBin'
                  ? 'cursor-crosshair'
                  : state.mode === 'setTruck'
                  ? 'cursor-pointer'
                  : 'cursor-default'
              }`}
            />
          </div>

          {/* Results table */}
          {route.length > 0 && (
            <div className="shrink-0 max-h-48 overflow-auto bg-gray-900 border-t border-gray-800">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-gray-800 z-10">
                  <tr>
                    {['순서', '통 ID', 'S(t) %', 'P(t)', 'U(t)', 'F_pull', 'F_push', '거리(px)'].map(
                      h => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left font-medium text-gray-400 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {route.map((r, i) => {
                    const bin = state.bins.find(b => b.id === r.binId)!
                    const isActive = isSimulating && i === simStep
                    return (
                      <tr
                        key={r.binId}
                        className={`border-t border-gray-800 ${
                          isActive
                            ? 'bg-indigo-900/60'
                            : i % 2 === 0
                            ? ''
                            : 'bg-white/[0.02]'
                        }`}
                      >
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-1.5 text-indigo-400 font-semibold">#{bin.id}</td>
                        <td className="px-3 py-1.5 text-yellow-400">{bin.saturation}</td>
                        <td className="px-3 py-1.5 text-orange-400">{bin.congestion.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-green-400 font-medium">
                          {r.u.toFixed(5)}
                        </td>
                        <td className="px-3 py-1.5 text-blue-400">{r.fpull.toFixed(5)}</td>
                        <td className="px-3 py-1.5 text-red-400">{r.fpush.toFixed(4)}</td>
                        <td className="px-3 py-1.5 text-gray-300">{r.stepDist.toFixed(1)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-t-2 border-gray-700 bg-gray-800">
                    <td colSpan={7} className="px-3 py-1.5 text-gray-400 font-medium">
                      총 이동 거리
                    </td>
                    <td className="px-3 py-1.5 text-white font-bold">{totalDist.toFixed(1)} px</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
