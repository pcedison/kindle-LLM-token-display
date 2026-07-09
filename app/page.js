'use client';

import { useMemo, useState } from 'react';

const PROFILES = [
  { value: 'dp75sdi', label: 'DP75SDI / Paperwhite 2 (758 x 1024)' },
  { value: 'kpw3', label: 'Paperwhite 3 (1072 x 1448)' },
  { value: 'voyage', label: 'Voyage (1080 x 1440)' },
  { value: 'basic', label: 'Kindle Basic (600 x 800)' },
];

const ENV_VARS = [
  'CLAUDE_STATUS_VALUE',
  'CLAUDE_RESET_LABEL',
  'OPENAI_STATUS_VALUE',
  'OPENAI_RESET_LABEL',
  'GEMINI_STATUS_VALUE',
  'GEMINI_RESET_LABEL',
];

export default function ConfigPage() {
  const [profile, setProfile] = useState('dp75sdi');
  const [showClaude, setShowClaude] = useState(true);
  const [showOpenAI, setShowOpenAI] = useState(true);
  const [showGemini, setShowGemini] = useState(false);
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');

  const kindleUrl = useMemo(() => {
    const baseUrl =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'https://your-vercel-domain.vercel.app';
    const params = new URLSearchParams({
      profile,
      claude: String(showClaude),
      openai: String(showOpenAI),
      gemini: String(showGemini),
    });

    if (customWidth.trim()) {
      params.set('w', customWidth.trim());
    }

    if (customHeight.trim()) {
      params.set('h', customHeight.trim());
    }

    return `${baseUrl}/api/dashboard?${params.toString()}`;
  }, [customHeight, customWidth, profile, showClaude, showGemini, showOpenAI]);

  return (
    <main
      className="config-main"
      style={{
        minHeight: '100vh',
        margin: 0,
        background: '#f7f7f4',
        color: '#151515',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: '40px 20px',
        boxSizing: 'border-box',
      }}
    >
      <section
        className="config-section"
        style={{
          width: '100%',
          maxWidth: '760px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <header>
          <h1
            className="config-title"
            style={{ margin: 0, fontSize: '32px', lineHeight: 1.15 }}
          >
            Kindle LLM Token Dashboard
          </h1>
          <p style={{ margin: '10px 0 0', color: '#555', lineHeight: 1.6 }}>
            選擇 Kindle profile 後，把下方 API URL 放進 Kindle 端抓圖腳本。
          </p>
        </header>

        <div
          className="config-card"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '18px',
            border: '1px solid #d9d9d0',
            background: '#fff',
            padding: '22px',
            borderRadius: '8px',
            boxSizing: 'border-box',
            minWidth: 0,
            width: '100%',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>Kindle profile</span>
            <select
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
              style={{
                minHeight: '42px',
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
                border: '1px solid #aaa',
                borderRadius: '6px',
                padding: '0 12px',
                fontSize: '16px',
                background: '#fff',
              }}
            >
              {PROFILES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div
            className="dimension-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '12px',
              minWidth: 0,
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Custom width</span>
              <input
                inputMode="numeric"
                placeholder="optional"
                value={customWidth}
                onChange={(event) => setCustomWidth(event.target.value)}
                style={{
                  minHeight: '42px',
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  border: '1px solid #aaa',
                  borderRadius: '6px',
                  padding: '0 12px',
                  fontSize: '16px',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontWeight: 700 }}>Custom height</span>
              <input
                inputMode="numeric"
                placeholder="optional"
                value={customHeight}
                onChange={(event) => setCustomHeight(event.target.value)}
                style={{
                  minHeight: '42px',
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  border: '1px solid #aaa',
                  borderRadius: '6px',
                  padding: '0 12px',
                  fontSize: '16px',
                }}
              />
            </label>
          </div>

          <div
            className="provider-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
              fontSize: '16px',
              minWidth: 0,
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={showClaude}
                onChange={(event) => setShowClaude(event.target.checked)}
              />{' '}
              Anthropic / Claude
            </label>
            <label>
              <input
                type="checkbox"
                checked={showOpenAI}
                onChange={(event) => setShowOpenAI(event.target.checked)}
              />{' '}
              OpenAI
            </label>
            <label>
              <input
                type="checkbox"
                checked={showGemini}
                onChange={(event) => setShowGemini(event.target.checked)}
              />{' '}
              Google / Gemini
            </label>
          </div>
        </div>

        <div
          className="config-card"
          style={{
            border: '1px solid #d9d9d0',
            background: '#fff',
            padding: '22px',
            borderRadius: '8px',
            boxSizing: 'border-box',
            minWidth: 0,
            width: '100%',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px' }}>Kindle API URL</h2>
          <code
            style={{
              display: 'block',
              marginTop: '12px',
              padding: '14px',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
              background: '#f2f2ed',
              border: '1px solid #deded6',
              borderRadius: '6px',
              color: '#064f8c',
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              lineHeight: 1.5,
            }}
          >
            {kindleUrl}
          </code>
        </div>

        <div
          className="config-card"
          style={{
            border: '1px solid #d9d9d0',
            background: '#fff',
            padding: '22px',
            borderRadius: '8px',
            boxSizing: 'border-box',
            minWidth: 0,
            width: '100%',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px' }}>Vercel env to fill</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '8px',
              marginTop: '12px',
            }}
          >
            {ENV_VARS.map((name) => (
              <code
                key={name}
                style={{
                  display: 'block',
                  padding: '10px',
                  background: '#f2f2ed',
                  border: '1px solid #deded6',
                  borderRadius: '6px',
                  color: '#333',
                  wordBreak: 'break-all',
                }}
              >
                {name}
              </code>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
