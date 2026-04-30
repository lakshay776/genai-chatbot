import { useState, useRef, useEffect, useCallback } from 'react';
import { PERSONAS } from './personas';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── helper: simulate streaming by revealing text char-by-char ─────────────
function useStreaming() {
  const [displayed, setDisplayed] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const rafRef = useRef(null);

  const stream = useCallback((fullText, onDone) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setDisplayed('');
    setIsStreaming(true);

    let i = 0;
    const CHARS_PER_TICK = 3; // speed: chars revealed per animation frame

    function tick() {
      i = Math.min(i + CHARS_PER_TICK, fullText.length);
      setDisplayed(fullText.slice(0, i));
      if (i < fullText.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setIsStreaming(false);
        onDone?.();
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return { displayed, isStreaming, stream };
}

// ── Cursor blink component ────────────────────────────────────────────────
function Cursor() {
  return <span className="blink-cursor">█</span>;
}

// ── Single chat bubble ────────────────────────────────────────────────────
function Bubble({ msg, isLast, streaming }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`bubble-row ${isUser ? 'bubble-row--user' : 'bubble-row--bot'}`}>
      {!isUser && <div className="avatar">{msg.avatar}</div>}
      <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--bot'}`}>
        {msg.content}
        {isLast && !isUser && streaming && <Cursor />}
      </div>
      {isUser && <div className="avatar avatar--user">YOU</div>}
    </div>
  );
}

// ── Typing dots indicator ─────────────────────────────────────────────────
function TypingIndicator({ avatar }) {
  return (
    <div className="bubble-row bubble-row--bot">
      <div className="avatar">{avatar}</div>
      <div className="bubble bubble--bot typing-bubble">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [activeKey, setActiveKey] = useState('anshuman');
  const [messages, setMessages] = useState([]);    // { role, content, avatar }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const { displayed, isStreaming, stream } = useStreaming();
  const persona = PERSONAS[activeKey];

  // Keep body class in sync with persona
  useEffect(() => {
    document.body.className = persona.className;
  }, [persona]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, displayed, loading]);

  // Switch persona → reset chat
  function switchPersona(key) {
    if (key === activeKey) return;
    setActiveKey(key);
    setMessages([]);
    setInput('');
    setError(null);
  }

  // Build history array for API (exclude the currently-streaming bot message)
  function buildHistory() {
    return messages
      .filter(m => m.role === 'user' || (m.role === 'bot' && !m._streaming))
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  }

  async function sendMessage(text) {
    if (!text.trim() || loading || isStreaming) return;
    setError(null);

    const userMsg = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: activeKey,
          message: text.trim(),
          history: buildHistory(),
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const fullReply = data.reply || 'No response.';
      setLoading(false);

      // Add a placeholder bot message that will be revealed char-by-char
      setMessages(prev => [
        ...prev,
        { role: 'bot', content: '', avatar: persona.initials, _streaming: true },
      ]);

      stream(fullReply, () => {
        // Replace placeholder with final text
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: 'bot',
            content: fullReply,
            avatar: persona.initials,
            _streaming: false,
          };
          return copy;
        });
      });
    } catch (err) {
      setLoading(false);
      setError('⚠ Connection failed. Is the backend running?');
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleChip(chip) {
    sendMessage(chip);
  }

  // What to show in the last bot bubble during streaming
  const renderMessages = messages.map((m, i) => {
    const isLast = i === messages.length - 1;
    const content = isLast && m.role === 'bot' && m._streaming ? displayed : m.content;
    return { ...m, content };
  });

  const showChips = messages.length === 0 && !loading;

  return (
    <div className="app">
      {/* ── Header ───────────────────────── */}
      <header className="header">
        <span className="header-logo">{'> SCALER.AI'}</span>
        <nav className="persona-tabs">
          {Object.values(PERSONAS).map(p => (
            <button
              key={p.key}
              className={`tab-btn ${activeKey === p.key ? 'tab-btn--active' : ''}`}
              onClick={() => switchPersona(p.key)}
            >
              <span className="tab-initials">{p.initials}</span>
              <span className="tab-name">{p.key.charAt(0).toUpperCase() + p.key.slice(1)}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* ── Active persona banner ─────────── */}
      <div className="persona-banner">
        <div className="persona-avatar">{persona.initials}</div>
        <div>
          <div className="persona-name">{persona.name}</div>
          <div className="persona-title">{'[ ' + persona.title + ' ]'}</div>
        </div>
        <div className="status-dot" title="Online" />
      </div>

      {/* ── Chat window ──────────────────── */}
      <main className="chat-window">
        {showChips && (
          <div className="welcome">
            <p className="welcome-text">{'> INITIALISING SESSION...'}</p>
            <p className="welcome-text">{'> TALKING TO: ' + persona.name.toUpperCase()}</p>
            <p className="welcome-text welcome-text--dim">{'> SELECT A PROMPT OR TYPE BELOW_'}</p>
            <div className="chips">
              {persona.chips.map(chip => (
                <button key={chip} className="chip" onClick={() => handleChip(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {renderMessages.map((m, i) => (
          <Bubble
            key={i}
            msg={m}
            isLast={i === renderMessages.length - 1}
            streaming={isStreaming}
          />
        ))}

        {loading && <TypingIndicator avatar={persona.initials} />}

        {error && <div className="error-bar">{error}</div>}

        <div ref={bottomRef} />
      </main>

      {/* ── Input bar ────────────────────── */}
      <form className="input-bar" onSubmit={handleSubmit}>
        <span className="input-prompt">{'>'}</span>
        <input
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={loading || isStreaming}
          autoFocus
        />
        <button
          className="send-btn"
          type="submit"
          disabled={loading || isStreaming || !input.trim()}
        >
          SEND
        </button>
      </form>
    </div>
  );
}
