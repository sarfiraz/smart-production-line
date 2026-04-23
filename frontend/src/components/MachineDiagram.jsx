import React, { useEffect, useState } from 'react'

/**
 * MachineDiagram component displays a real-time SVG diagram of the production line.
 * 
 * @param {Object} props
 * @param {Object} [props.io] - Digital inputs { I_1, I_2, I_3, I_4 }
 * @param {Object} [props.pwms] - PWM outputs { PWM_1, PWM_2, PWM_3, PWM_4 }
 * @param {string} [props.decisionLevel] - Decision level: NORMAL, WARNING, CRITICAL, EMERGENCY_STOP, etc.
 * @param {string} [props.machineState] - Runtime machine state from store
 * @param {string} [props.lastUpdate] - ISO timestamp of last update
 * @param {string} [props.focusedSubsystem] - Currently focused subsystem: "BELT" | "PUNCH" | "SENSORS" | "SYSTEM" | null
 * @param {Function} [props.onSubsystemSelect] - Callback when a subsystem is clicked
 */
const MachineDiagram = ({
  io,
  pwms,
  decisionLevel,
  machineState,
  lastUpdate,
  focusedSubsystem = null,
  onSubsystemSelect,
}) => {
  const entryX = 120

  // Check if we have any data
  const hasData = io !== undefined && pwms !== undefined

  // Sensor states: I_1 and I_2 are active when == 0, I_3 and I_4 are active when == 1
  const I1Active = io?.I_1 === 0
  const I2Active = io?.I_2 === 0
  const I3Active = io?.I_3 === 1
  const I4Active = io?.I_4 === 1

  // PWM states: active >= 51, inactive == 0, invalid 1-50
  const getPWMState = (pwm) => {
    if (pwm === undefined) return 'missing'
    if (pwm === 0) return 'inactive'
    if (pwm >= 51) return 'active'
    return 'invalid'
  }

  const PWM1State = getPWMState(pwms?.PWM_1)
  const PWM2State = getPWMState(pwms?.PWM_2)
  const PWM3State = getPWMState(pwms?.PWM_3)
  const PWM4State = getPWMState(pwms?.PWM_4)

  // Punch position logic
  const getPunchPosition = () => {
    if (!io || I3Active === undefined || I4Active === undefined) return 'unknown'
    if (I3Active && !I4Active) return 'up' // I_3 == 1, I_4 == 0
    if (!I3Active && I4Active) return 'down' // I_3 == 0, I_4 == 1
    if (!I3Active && !I4Active) return 'moving' // both 0
    if (I3Active && I4Active) return 'impossible' // both 1
    return 'unknown'
  }

  const punchPosition = getPunchPosition()
  const punchMovingByPwm = PWM3State === 'active' || PWM4State === 'active'
  const punchUpY = 40
  const punchDownY = 100

  // Belt direction for movement visualization:
  // RevPi publishes numeric PWM values (0-100), so treat any value > 0 as motion.
  const beltForward = Number(pwms?.PWM_1 ?? 0) > 0
  const beltReverse = Number(pwms?.PWM_2 ?? 0) > 0
  const beltIllegal = beltForward && beltReverse
  const isProducing = machineState === 'PRODUCING'
  const machineRuntimeState = (machineState || 'WAITING').toUpperCase()

  const getWorkpieceColors = () => {
    if (machineRuntimeState === 'EMERGENCY_STOP') {
      return {
        fill: '#ef4444',
        stroke: '#b91c1c',
      }
    }
    if (machineRuntimeState === 'PRODUCING') {
      return {
        fill: '#f59e0b',
        stroke: '#b45309',
      }
    }
    return {
      fill: '#3b82f6',
      stroke: '#1d4ed8',
    }
  }

  // Decision level border color
  const getDecisionBorderColor = () => {
    if (!decisionLevel) return 'rgb(156, 163, 175)' // gray-400
    switch (decisionLevel) {
      case 'NORMAL':
        return 'rgb(34, 197, 94)' // green-500
      case 'WARNING':
        return 'rgb(234, 179, 8)' // yellow-500
      case 'CRITICAL':
        return 'rgb(239, 68, 68)' // red-500
      case 'EMERGENCY_STOP':
        return 'rgb(220, 38, 38)' // red-600
      default:
        return 'rgb(156, 163, 175)' // gray-400
    }
  }

  const borderColor = getDecisionBorderColor()
  const isEmergencyStop = decisionLevel === 'EMERGENCY_STOP'

  // Sensor color helper
  const getSensorColor = (active) => {
    if (active === undefined) return 'rgb(229, 231, 235)' // light gray (missing)
    return active ? 'rgb(34, 197, 94)' : 'rgb(75, 85, 99)' // green : dark gray
  }

  // PWM color helper
  const getPWMColor = (state) => {
    switch (state) {
      case 'active':
        return 'rgb(34, 197, 94)' // green
      case 'inactive':
        return 'rgb(156, 163, 175)' // gray-400
      case 'invalid':
        return 'rgb(239, 68, 68)' // red
      default:
        return 'rgb(229, 231, 235)' // light gray (missing)
    }
  }

  const stationX = 470
  const [displayX, setDisplayX] = useState(entryX)
  const [arrowOffset, setArrowOffset] = useState(0)
  const [punchY, setPunchY] = useState(punchUpY)

  useEffect(() => {
    if (I1Active) setDisplayX(entryX)
    if (I2Active) setDisplayX(stationX)
  }, [I1Active, I2Active])

  useEffect(() => {
    if (!beltForward && !beltReverse) return

    const speed = 2
    const interval = setInterval(() => {
      setDisplayX((prev) => {
        if (beltForward) return Math.min(prev + speed, stationX)
        if (beltReverse) return Math.max(prev - speed, entryX)
        return prev
      })
    }, 16)

    return () => clearInterval(interval)
  }, [beltForward, beltReverse])

  useEffect(() => {
    if (!beltForward && !beltReverse) return

    const interval = setInterval(() => {
      setArrowOffset((prev) => prev + 4)
    }, 40)

    return () => clearInterval(interval)
  }, [beltForward, beltReverse])

  useEffect(() => {
    if (I3Active) setPunchY(punchUpY)
    if (I4Active) setPunchY(punchDownY)
  }, [I3Active, I4Active])

  useEffect(() => {
    if (!punchMovingByPwm) return

    const speed = 1.5
    const interval = setInterval(() => {
      setPunchY((prev) => {
        if (PWM4State === 'active') {
          return Math.min(prev + speed, punchDownY)
        }
        if (PWM3State === 'active') {
          return Math.max(prev - speed, punchUpY)
        }
        return prev
      })
    }, 16)

    return () => clearInterval(interval)
  }, [PWM3State, PWM4State, punchMovingByPwm])

  const workpieceColors = getWorkpieceColors()
  const showObject = true
  const sensorTooltips = {
    I1: 'Entry Sensor (I1) – detects object entering conveyor',
    I2: 'Punch Station Sensor (I2) – detects object under punch',
    I3: 'Punch Upper Limit (I3) – punch fully raised',
    I4: 'Punch Lower Limit (I4) – punch fully pressed',
  }
  const motorTooltips = {
    PWM1: 'Conveyor Motor Forward',
    PWM2: 'Conveyor Motor Reverse',
    PWM3: 'Punch Motor Up',
    PWM4: 'Punch Motor Down',
  }

  // SVG dimensions
  const width = 900
  const height = 320
  const viewBox = `0 0 ${width} ${height}`

  // Visual focus logic
  const getSubsystemOpacity = (subsystem) => {
    if (!focusedSubsystem) return 1.0
    return focusedSubsystem === subsystem ? 1.0 : 0.25
  }

  const getSubsystemStyle = (subsystem) => {
    const isFocused = focusedSubsystem === subsystem
    const opacity = getSubsystemOpacity(subsystem)
    
    return {
      opacity,
      cursor: onSubsystemSelect ? 'pointer' : 'default',
      filter: isFocused && focusedSubsystem ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))' : 'none',
      transition: 'opacity 0.2s ease, filter 0.2s ease',
      pointerEvents: 'all',
    }
  }

  const handleSubsystemClick = (subsystem) => {
    if (onSubsystemSelect) {
      onSubsystemSelect(subsystem)
    }
  }

  const getSubsystemTitle = (subsystem) => {
    const titles = {
      BELT: 'Belt subsystem',
      PUNCH: 'Punch subsystem',
      SENSORS: 'Sensors subsystem',
      SYSTEM: 'System',
    }
    return titles[subsystem] || ''
  }

  return (
    <div className="w-full h-full">
      <div className="bg-card rounded-lg border-2 p-4 h-full flex flex-col min-h-0" style={{ borderColor, borderWidth: isEmergencyStop ? 3 : 2 }}>
        {isEmergencyStop && (
          <style>{`
            @keyframes flash {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
            .emergency-border {
              animation: flash 0.5s infinite;
            }
          `}</style>
        )}
        <div className={`${isEmergencyStop ? 'emergency-border' : ''} flex-1 min-h-0 flex items-center justify-center`}>
          <div className="w-full max-h-full aspect-[900/320]">
            <svg
              width="100%"
              height="100%"
              viewBox={viewBox}
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-full block"
            >
            {/* Background */}
            <rect width={width} height={height} fill="rgb(249, 250, 251)" />

            {/* SYSTEM group: Outer frame */}
            <g
              data-subsystem="SYSTEM"
              style={getSubsystemStyle('SYSTEM')}
              onClick={() => handleSubsystemClick('SYSTEM')}
              title={getSubsystemTitle('SYSTEM')}
            >
              {/* Transparent hit area for clicking */}
              <rect
                width={width}
                height={height}
                fill="transparent"
                pointerEvents="all"
              />
              <rect
                x={1}
                y={1}
                width={width - 2}
                height={height - 2}
                fill="none"
                stroke="rgb(156, 163, 175)"
                strokeWidth={2}
                strokeDasharray="4,4"
                opacity={0.3}
              />
            </g>

            {/* BELT group: Belt track, arrows, workpiece, PWM_1, PWM_2 */}
            <g
              data-subsystem="BELT"
              style={getSubsystemStyle('BELT')}
              onClick={() => handleSubsystemClick('BELT')}
              title={getSubsystemTitle('BELT')}
            >
              {/* Transparent hit area for clicking */}
              <rect x={40} y={130} width={820} height={130} fill="transparent" pointerEvents="all" />
              {/* Conveyor belt rails */}
              <rect
                x={40}
                y={132}
                width={820}
                height={8}
                fill="rgb(203, 213, 225)"
                stroke="rgb(148, 163, 184)"
                strokeWidth={1}
              />
              <rect
                x={40}
                y={140}
                width={820}
                height={24}
                fill="rgb(55, 65, 81)"
                stroke="rgb(31, 41, 55)"
                strokeWidth={2}
              />
              <rect
                x={40}
                y={164}
                width={820}
                height={12}
                fill="rgb(30, 41, 59)"
              />
              <rect
                x={40}
                y={176}
                width={820}
                height={8}
                fill="rgb(203, 213, 225)"
                stroke="rgb(148, 163, 184)"
                strokeWidth={1}
              />

              {/* Belt direction arrows (subtle) */}
              {isProducing && beltForward && !beltIllegal && (
                <g>
                  {Array.from({ length: 22 }, (_, idx) => 40 + idx * 40).map((baseX) => {
                    const spacing = 40
                    const x = baseX + (arrowOffset % spacing)
                    if (x < 48 || x > 840) return null
                    return (
                      <polygon
                        key={`fwd-${baseX}`}
                        points={`${x + 12},152 ${x},146 ${x},158`}
                        fill="rgb(148, 163, 184)"
                        opacity={0.7}
                      />
                    )
                  })}
                </g>
              )}
              {isProducing && beltReverse && !beltIllegal && (
                <g>
                  {Array.from({ length: 22 }, (_, idx) => 40 + idx * 40).map((baseX) => {
                    const spacing = 40
                    const x = baseX - (arrowOffset % spacing)
                    if (x < 48 || x > 840) return null
                    return (
                      <polygon
                        key={`rev-${baseX}`}
                        points={`${x},152 ${x + 12},146 ${x + 12},158`}
                        fill="rgb(148, 163, 184)"
                        opacity={0.7}
                      />
                    )
                  })}
                </g>
              )}
              {beltIllegal && (
                <text
                  x={width / 2}
                  y={148}
                  textAnchor="middle"
                  fill="rgb(239, 68, 68)"
                  fontSize="16"
                  fontWeight="bold"
                >
                   ILLEGAL STATE
                </text>
              )}

              {/* Square workpiece */}
              {showObject && (
                <rect
                  x={displayX}
                  y={141}
                  width={22}
                  height={22}
                  rx={2}
                  fill={workpieceColors.fill}
                  stroke={workpieceColors.stroke}
                  strokeWidth={2}
                  style={{
                    filter: 'drop-shadow(0 1px 2px rgba(15, 23, 42, 0.35))',
                    transition: 'all 0.1s linear',
                  }}
                />
              )}

              {/* Actuator indicators - PWM_1 (belt forward) */}
              <g title={motorTooltips.PWM1}>
                <title>{motorTooltips.PWM1}</title>
                <rect
                  x={60}
                  y={200}
                  width={40}
                  height={30}
                  fill={getPWMColor(PWM1State)}
                  stroke="rgb(75, 85, 99)"
                  strokeWidth={PWM1State === 'invalid' ? 3 : 1}
                  opacity={PWM1State === 'invalid' ? 0.8 : 1}
                />
                <text x={80} y={218} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">
                  FWD
                </text>
                <text x={80} y={245} textAnchor="middle" fontSize="8" fill="rgb(75, 85, 99)">
                  PWM_1
                </text>
              </g>

              {/* Actuator indicators - PWM_2 (belt reverse) */}
              <g title={motorTooltips.PWM2}>
                <title>{motorTooltips.PWM2}</title>
                <rect
                  x={110}
                  y={200}
                  width={40}
                  height={30}
                  fill={getPWMColor(PWM2State)}
                  stroke="rgb(75, 85, 99)"
                  strokeWidth={PWM2State === 'invalid' ? 3 : 1}
                  opacity={PWM2State === 'invalid' ? 0.8 : 1}
                />
                <text x={130} y={218} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">
                  REV
                </text>
                <text x={130} y={245} textAnchor="middle" fontSize="8" fill="rgb(75, 85, 99)">
                  PWM_2
                </text>
              </g>
            </g>

            {/* PUNCH group: Punch station, rod, head, PWM_3, PWM_4 */}
            <g
              data-subsystem="PUNCH"
              style={getSubsystemStyle('PUNCH')}
              onClick={() => handleSubsystemClick('PUNCH')}
              title={getSubsystemTitle('PUNCH')}
            >
              {/* Transparent hit area for clicking */}
              <rect x={420} y={35} width={220} height={130} fill="transparent" pointerEvents="all" />
              {/* Punch station frame */}
              <rect
                x={440}
                y={55}
                width={160}
                height={96}
                fill="rgb(229, 231, 235)"
                stroke="rgb(107, 114, 128)"
                strokeWidth={3}
              />

              {/* Punch rod */}
              <rect
                x={515}
                y={20}
                width={10}
                height={punchY - 20}
                fill="rgb(100, 116, 139)"
                stroke="rgb(71, 85, 105)"
                strokeWidth={1}
                style={{ transition: 'all 0.1s linear' }}
              />

              {/* Punch head */}
              <rect
                x={455}
                y={punchY}
                width={130}
                height={22}
                fill={
                  punchMovingByPwm || punchPosition === 'moving'
                    ? 'rgb(249, 115, 22)'
                    : punchPosition === 'impossible'
                    ? 'rgb(239, 68, 68)'
                    : 'rgb(107, 114, 128)'
                }
                stroke="rgb(75, 85, 99)"
                strokeWidth={2}
                style={{ transition: 'all 0.1s linear' }}
              />

              {/* Actuator indicators - PWM_3 (punch up) */}
              <g title={motorTooltips.PWM3}>
                <title>{motorTooltips.PWM3}</title>
                <rect
                  x={680}
                  y={50}
                  width={40}
                  height={30}
                  fill={getPWMColor(PWM3State)}
                  stroke="rgb(75, 85, 99)"
                  strokeWidth={PWM3State === 'invalid' ? 3 : 1}
                  opacity={PWM3State === 'invalid' ? 0.8 : 1}
                />
                <text x={700} y={68} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">
                  UP
                </text>
                <text x={700} y={95} textAnchor="middle" fontSize="8" fill="rgb(75, 85, 99)">
                  PWM_3
                </text>
              </g>

              {/* Actuator indicators - PWM_4 (punch down) */}
              <g title={motorTooltips.PWM4}>
                <title>{motorTooltips.PWM4}</title>
                <rect
                  x={740}
                  y={50}
                  width={40}
                  height={30}
                  fill={getPWMColor(PWM4State)}
                  stroke="rgb(75, 85, 99)"
                  strokeWidth={PWM4State === 'invalid' ? 3 : 1}
                  opacity={PWM4State === 'invalid' ? 0.8 : 1}
                />
                <text x={760} y={68} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">
                  DWN
                </text>
                <text x={760} y={95} textAnchor="middle" fontSize="8" fill="rgb(75, 85, 99)">
                  PWM_4
                </text>
              </g>
            </g>

            {/* SENSORS group: I_1, I_2, I_3, I_4 LED indicators */}
            <g
              data-subsystem="SENSORS"
              style={getSubsystemStyle('SENSORS')}
              onClick={() => handleSubsystemClick('SENSORS')}
              title={getSubsystemTitle('SENSORS')}
            >
              {/* Transparent hit areas for clicking each sensor */}
              <rect x={105} y={35} width={30} height={145} fill="transparent" pointerEvents="all" />
              <rect x={455} y={35} width={30} height={145} fill="transparent" pointerEvents="all" />
              <rect x={505} y={30} width={30} height={25} fill="transparent" pointerEvents="all" />
              <rect x={505} y={125} width={30} height={25} fill="transparent" pointerEvents="all" />
              {/* Sensor indicators - I_1 (start position) */}
              <g title={sensorTooltips.I1}>
                <title>{sensorTooltips.I1}</title>
                <circle cx={120} cy={130} r={10} fill="rgb(17, 24, 39)" stroke="rgb(75, 85, 99)" strokeWidth={1} />
                <circle cx={120} cy={130} r={6} fill={getSensorColor(I1Active)} />
                <text x={120} y={120} textAnchor="middle" fontSize="10" fill="rgb(75, 85, 99)">
                  I_1
                </text>
                <line x1={120} y1={140} x2={120} y2={164} stroke={getSensorColor(I1Active)} strokeWidth={2} />
              </g>

              {/* Sensor indicators - I_2 (station position) */}
              <g title={sensorTooltips.I2}>
                <title>{sensorTooltips.I2}</title>
                <circle cx={470} cy={130} r={10} fill="rgb(17, 24, 39)" stroke="rgb(75, 85, 99)" strokeWidth={1} />
                <circle cx={470} cy={130} r={6} fill={getSensorColor(I2Active)} />
                <text x={470} y={120} textAnchor="middle" fontSize="10" fill="rgb(75, 85, 99)">
                  I_2
                </text>
                <line x1={470} y1={140} x2={470} y2={164} stroke={getSensorColor(I2Active)} strokeWidth={2} />
              </g>

              {/* Sensor indicators - I_3 (upper limit) */}
              <g title={sensorTooltips.I3}>
                <title>{sensorTooltips.I3}</title>
                <circle cx={520} cy={50} r={10} fill="rgb(17, 24, 39)" stroke="rgb(75, 85, 99)" strokeWidth={1} />
                <circle cx={520} cy={50} r={6} fill={getSensorColor(I3Active)} />
                <text x={520} y={40} textAnchor="middle" fontSize="10" fill="rgb(75, 85, 99)">
                  I_3
                </text>
                <line x1={520} y1={58} x2={520} y2={60} stroke={getSensorColor(I3Active)} strokeWidth={2} />
              </g>

              {/* Sensor indicators - I_4 (lower limit) */}
              <g title={sensorTooltips.I4}>
                <title>{sensorTooltips.I4}</title>
                <circle cx={520} cy={140} r={10} fill="rgb(17, 24, 39)" stroke="rgb(75, 85, 99)" strokeWidth={1} />
                <circle cx={520} cy={140} r={6} fill={getSensorColor(I4Active)} />
                <text x={520} y={170} textAnchor="middle" fontSize="10" fill="rgb(75, 85, 99)">
                  I_4
                </text>
                <line x1={520} y1={132} x2={520} y2={140} stroke={getSensorColor(I4Active)} strokeWidth={2} />
              </g>
            </g>

            {/* "Awaiting data" overlay */}
            {!hasData && (
              <g>
                <rect
                  x={width / 2 - 100}
                  y={height / 2 - 20}
                  width={200}
                  height={40}
                  fill="rgba(229, 231, 235, 0.9)"
                  stroke="rgb(156, 163, 175)"
                  strokeWidth={2}
                  rx={4}
                />
                <text
                  x={width / 2}
                  y={height / 2 + 5}
                  textAnchor="middle"
                  fontSize="16"
                  fill="rgb(107, 114, 128)"
                  fontWeight="bold"
                >
                  Awaiting data...
                </text>
              </g>
            )}
            </svg>
          </div>
        </div>

        {/* Helper text */}
        {onSubsystemSelect && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Click subsystem to focus
          </div>
        )}

        {/* Last update timestamp */}
        {lastUpdate && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Last update: {new Date(lastUpdate).toLocaleString()}
          </div>
        )}
        {!hasData && (
          <div className="mt-2 text-center text-xs text-muted-foreground italic">
            Awaiting data...
          </div>
        )}
      </div>
    </div>
  )
}

export default MachineDiagram

