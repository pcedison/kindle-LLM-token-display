'use client';
import { useState } from 'react';

export default function ConfigPage() {
  const [showClaude, setShowClaude] = useState(true);
  const [showOpenAI, setShowOpenAI] = useState(true);
  const [showGemini, setShowGemini] = useState(false);

  // 取得目前的網域網址
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-vercel-domain.vercel.app';
  const kindleUrl = `${baseUrl}/api/dashboard?claude=${showClaude}&openai=${showOpenAI}&gemini=${showGemini}`;

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h1>🔋 Kindle LLM 儀表板控制後台</h1>
      <p>請勾選你想要在 Kindle 畫面上顯示的模型：</p>
      
      <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: '15px', fontSize: '18px' }}>
        <label><input type="checkbox" checked={showClaude} onChange={(e) => setShowClaude(e.target.checked)} /> 🤖 Anthropic - Claude Code</label>
        <label><input type="checkbox" checked={showOpenAI} onChange={(e) => setShowOpenAI(e.target.checked)} /> 🧠 OpenAI - Codex Tier</label>
        <label><input type="checkbox" checked={showGemini} onChange={(e) => setShowGemini(e.target.checked)} /> ✨ Google - Gemini API</label>
      </div>

      <div style={{ marginTop: '40px', padding: '20px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
        <h3>🎯 Kindle 端專用網址：</h3>
        <code style={{ wordBreak: 'break-all', color: '#0070f3', display: 'block', margin: '10px 0' }}>{kindleUrl}</code>
        <p style={{ fontSize: '14px', color: '#666' }}>把這串網址複製起來，填入 Kindle 的 <code>fetch-dashboard.sh</code> 裡面即可！</p>
      </div>
    </div>
  );
}