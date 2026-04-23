import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Alert, AlertDescription } from '../components/ui/Alert'
import { Label } from '../components/ui/Label'
import {
  MessageSquare,
  Bot,
  AlertCircle,
  Send,
  Shield,
  Brain,
  Activity,
  User,
  Trash2,
} from 'lucide-react'
import { useHistoryStore } from '../store/historyStore'
import { useSystemStatusStore } from '../store/systemStatusStore'
import { useNotificationStore } from '../store/notificationStore'
import { motion } from 'framer-motion'
import api from '../api/axios'

const SECTION_LABELS = ['SUMMARY', 'TECHNICAL CAUSE', 'RECOMMENDED ACTIONS']

const parseSectionBlocks = (text) => {
  const lines = String(text || '').split(/\r?\n/)
  const sections = {}
  let current = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const normalized = line.replace(/^#+\s*/, '').replace(/:$/, '').trim().toUpperCase()
    if (SECTION_LABELS.includes(normalized)) {
      current = normalized
      if (!sections[current]) sections[current] = []
      continue
    }
    if (current) sections[current].push(rawLine)
  }

  return {
    summary: (sections.SUMMARY || []).join('\n').trim(),
    technicalCause: (sections['TECHNICAL CAUSE'] || []).join('\n').trim(),
    recommendedActions: (sections['RECOMMENDED ACTIONS'] || []).join('\n').trim(),
  }
}

const parseActionLines = (text) => {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d\.\)\s]+/, '').trim())
    .filter(Boolean)
}

const getAssistantSections = (message) => {
  const parsed = parseSectionBlocks(message.content || '')
  const summary = (message.summary || parsed.summary || '').trim()
  const technicalCause = (parsed.technicalCause || message.content || '').trim()
  const recommendedActions = Array.isArray(message.actions) && message.actions.length > 0
    ? message.actions
    : parseActionLines(parsed.recommendedActions)

  return { summary, technicalCause, recommendedActions }
}

const EXAMPLE_QUESTIONS = [
  'Why did the machine stop?',
  'What caused the last anomaly?',
  'What should I check first?',
  'Which component is likely faulty?',
  'Is it safe to restart the machine?',
  'What sensor might be failing?',
  'What does this warning mean?',
  'What changed in the last cycle?',
  'Is machine behavior normal?',
  'What action should I take now?',
  'Why is the anomaly score high?',
  'What triggered the emergency stop?',
]

const Interpretations = () => {
  const { interpretations } = useHistoryStore()
  const { lastDecision, currentDecisionLevel, currentMachineState, wsConnected } = useSystemStatusStore()
  const { error: notifyError, success } = useNotificationStore()
  const [question, setQuestion] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [isClearingChat, setIsClearingChat] = useState(false)
  const [messages, setMessages] = useState([])

  const latestDecision = lastDecision || null
  const latestInterpretation = interpretations[0] || null
  const decisionStatus = (latestDecision?.decision_level || currentDecisionLevel || 'N/A').toUpperCase()
  const anomalyScore = latestDecision?.anomaly_score ?? latestDecision?.ml_result?.anomaly_score ?? null
  const decisionCycleId = latestDecision?.cycle_id ?? latestInterpretation?.cycle_id ?? 'N/A'
  const showInterpretationContent =
    decisionStatus === 'WARNING' ||
    decisionStatus === 'CRITICAL' ||
    decisionStatus === 'EMERGENCY_STOP'

  const recommendationList = useMemo(() => {
    if (!latestInterpretation) return []
    return (
      latestInterpretation.recommended_actions ||
      latestInterpretation.interpretation?.recommended_actions ||
      []
    )
  }, [latestInterpretation])

  const getDecisionBadgeVariant = (level) => {
    if (level === 'NORMAL') return 'normal'
    if (level === 'WARNING') return 'warning'
    if (level === 'CRITICAL') return 'critical'
    if (level === 'EMERGENCY_STOP') return 'emergency'
    return 'default'
  }

  useEffect(() => {
    let cancelled = false

    const loadHistory = async () => {
      try {
        const response = await api.get('/api/assistant/history')
        if (cancelled) return
        const rows = Array.isArray(response.data) ? response.data : []
        const hydrated = rows.map((row) => ({
          id: `history-${row.id}`,
          role: row.role === 'operator' ? 'operator' : 'assistant',
          content: row.content || '',
          cycleId: row.cycle_id ?? null,
          timestamp: row.timestamp ?? null,
        }))
        setMessages(hydrated)
      } catch (err) {
        if (!cancelled) {
          notifyError(err.response?.data?.detail || 'Failed to load assistant chat history')
        }
      }
    }

    loadHistory()
    return () => {
      cancelled = true
    }
  }, [notifyError])

  const handleAskAssistant = async () => {
    const trimmed = question.trim()
    if (!trimmed || isAsking || !wsConnected) return

    const operatorMessage = {
      id: `operator-${Date.now()}`,
      role: 'operator',
      content: trimmed,
    }
    setMessages((prev) => [...prev, operatorMessage])
    setIsAsking(true)
    try {
      const response = await api.post('/api/assistant/ask', {
        question: trimmed,
        snapshot: lastDecision || null,
      })
      const interpretation = response.data?.interpretation || {}
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        summary: interpretation.authoritative_summary || null,
        content:
          interpretation.technical_explanation ||
          interpretation.authoritative_summary ||
          'No explanation returned.',
        actions: interpretation.recommended_operator_actions || [],
      }
      setMessages((prev) => [...prev, assistantMessage])
      setQuestion('')
    } catch (err) {
      const errorMessage = err.response?.data?.detail || 'Failed to get response from assistant'
      notifyError(errorMessage)
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${errorMessage}`,
          actions: [],
          isError: true,
        },
      ])
    } finally {
      setIsAsking(false)
    }
  }

  const handleClearChat = async () => {
    if (isClearingChat) return
    setIsClearingChat(true)
    try {
      await api.delete('/api/assistant/history')
      setMessages([])
      success('Assistant chat history cleared.')
    } catch (err) {
      notifyError(err.response?.data?.detail || 'Failed to clear assistant chat history')
    } finally {
      setIsClearingChat(false)
    }
  }

  const anomalyScoreHint = useMemo(() => {
    const level = decisionStatus
    if (level === 'NORMAL') return 'below warning threshold'
    if (level === 'WARNING') return 'warning threshold reached'
    if (level === 'CRITICAL' || level === 'EMERGENCY_STOP') return 'critical threshold reached'
    return 'awaiting machine data'
  }, [decisionStatus])

  const machineStateText = (currentMachineState || 'STOPPED').toString().toUpperCase()
  const decisionText = (latestDecision?.decision_level || 'N/A').toString().toUpperCase()
  const cycleText = latestDecision?.cycle_id ?? 'N/A'

  return (
    <div className="h-full flex flex-col gap-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <MessageSquare className="h-8 w-8 text-primary" />
            AI Interpretation
          </h1>
          <p className="text-muted-foreground mt-1.5">
            ChatGPT-assisted interpretation of machine state and ML signals
          </p>
        </div>
        <Badge variant={wsConnected ? 'normal' : 'emergency'} className="gap-2 px-4 py-2">
          <Bot className="h-4 w-4" />
          {wsConnected ? 'Live' : 'Offline'}
        </Badge>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex-1 min-h-0"
      >
        <div className="grid grid-cols-[65%_35%] gap-4 h-full min-h-0">
          <div className="min-h-0">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Operator Assistant
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearChat}
                    disabled={isClearingChat}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {isClearingChat ? 'Clearing...' : 'Clear Chat'}
                  </Button>
                </div>
                <CardDescription>
                  Ask questions about current machine state and anomalies
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col gap-3">
                <div className="flex gap-2">
                  <Input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask about faults, cause, or next checks..."
                    disabled={isAsking || !wsConnected}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAskAssistant()
                      }
                    }}
                  />
                  <Button
                    onClick={handleAskAssistant}
                    disabled={isAsking || !question.trim() || !wsConnected}
                  >
                    {isAsking ? 'Sending...' : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Send
                      </>
                    )}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Example questions:</p>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLE_QUESTIONS.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setQuestion(example)}
                        className="bg-slate-800 hover:bg-slate-700 rounded px-3 py-1 text-xs text-slate-100 transition-colors"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>

                {!wsConnected && (
                  <p className="text-xs text-muted-foreground">
                    WebSocket disconnected. Waiting for live state.
                  </p>
                )}

                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Machine: <span className="font-semibold text-foreground">{machineStateText}</span>
                  {' | '}
                  Decision: <span className="font-semibold text-foreground">{decisionText}</span>
                  {' | '}
                  Cycle: <span className="font-semibold text-foreground font-mono">{cycleText}</span>
                </div>

                <div className="rounded-lg border bg-muted/30 p-3 flex-1 min-h-0 overflow-y-auto">
                  {messages.length > 0 ? (
                    <div className="space-y-3">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.role === 'operator' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
                              message.role === 'operator'
                                ? 'bg-blue-600 text-white rounded-br-md'
                                : message.isError
                                  ? 'bg-destructive/15 border border-destructive/30 text-foreground rounded-bl-md'
                                  : 'bg-card border border-border text-foreground rounded-bl-md'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {message.role === 'operator' ? (
                                <User className="h-3.5 w-3.5 text-blue-100" />
                              ) : (
                                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <span className="text-[11px] font-medium opacity-80">
                                {message.role === 'operator' ? 'Operator' : 'Assistant'}
                              </span>
                            </div>

                            {message.role === 'assistant' && !message.isError ? (
                              (() => {
                                const sections = getAssistantSections(message)
                                return (
                                  <div className="space-y-4">
                                    {sections.summary && (
                                      <div className="space-y-1.5">
                                        <h4 className="text-xs font-semibold tracking-wide">SUMMARY</h4>
                                        <p className="text-sm whitespace-pre-wrap break-words">{sections.summary}</p>
                                      </div>
                                    )}
                                    {sections.technicalCause && (
                                      <div className="space-y-1.5">
                                        <h4 className="text-xs font-semibold tracking-wide">TECHNICAL CAUSE</h4>
                                        <p className="text-sm whitespace-pre-wrap break-words">{sections.technicalCause}</p>
                                      </div>
                                    )}
                                    {sections.recommendedActions.length > 0 && (
                                      <div className="space-y-1.5">
                                        <h4 className="text-xs font-semibold tracking-wide">RECOMMENDED ACTIONS</h4>
                                        <ul className="space-y-1">
                                          {sections.recommendedActions.map((action, idx) => (
                                            <li key={`${action}-${idx}`} className="text-xs flex items-start gap-2 whitespace-pre-wrap break-words">
                                              <AlertCircle className="h-3 w-3 mt-0.5 text-info flex-shrink-0" />
                                              <span>{action}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()
                            ) : (
                              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      No messages yet. Ask AI to start.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="min-h-0">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  Latest AI Interpretation
                </CardTitle>
                <CardDescription>
                  Structured interpretation for operator decision support
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 overflow-y-auto min-h-0">
                <Alert variant="info" className="border-info/50 bg-info/5">
                  <Shield className="h-5 w-5 text-info" />
                  <AlertDescription className="text-sm">
                    Advisory only: use Controls page for machine actions.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <div className="mt-1">
                      <Badge variant={getDecisionBadgeVariant(decisionStatus)}>
                        {decisionStatus || 'N/A'}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Anomaly Score</Label>
                    <p className="mt-1 text-sm font-semibold">
                      {typeof anomalyScore === 'number' ? anomalyScore.toFixed(2) : 'N/A'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      ({anomalyScoreHint})
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Cycle ID</Label>
                    <p className="mt-1 text-sm font-mono">
                      {decisionCycleId}
                    </p>
                  </div>
                </div>

                {decisionStatus === 'NORMAL' ? (
                  <Card className="border-normal/30 bg-normal/5">
                    <CardContent className="py-10 flex items-center justify-center">
                      <p className="text-sm font-medium text-center">
                        Machine operating normally. No anomaly interpretation required.
                      </p>
                    </CardContent>
                  </Card>
                ) : showInterpretationContent ? (
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">AI Summary</Label>
                      <p className="mt-1 text-sm leading-relaxed">
                        {latestInterpretation?.authoritative_summary ||
                          latestInterpretation?.interpretation?.summary ||
                          'Awaiting interpretation data...'}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Technical Explanation</Label>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {latestInterpretation?.technical_explanation ||
                          latestInterpretation?.interpretation?.severity_explanation ||
                          'Awaiting interpretation data...'}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Recommended Operator Actions</Label>
                      {recommendationList.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {recommendationList.map((action, idx) => (
                            <li key={`${action}-${idx}`} className="text-sm flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 mt-0.5 text-info flex-shrink-0" />
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                          No recommended actions available.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-10 flex items-center justify-center">
                      <p className="text-sm font-medium text-center">
                        Machine operating normally. No anomaly interpretation required.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.div>

    </div>
  )
}

export default Interpretations
