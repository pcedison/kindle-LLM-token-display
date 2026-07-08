import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  
  const showClaude = searchParams.get('claude') !== 'false';
  const showOpenAI = searchParams.get('openai') !== 'false';
  const showGemini = searchParams.get('gemini') === 'true';

  // 模擬數據 (等一下畫面正常後，我們就來把這裡換成真實 API)
  let claudeUsage = { remaining: "$42.15", reset: "08/01" };
  let openAIUsage = { remaining: "78%", reset: "07/31" };
  let geminiUsage = { remaining: "4.5k/5k", reset: "24h" };

  return new ImageResponse(
    (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '758px',        // 縮小到 KPW3 完美的相容寬度
        height: '1024px',      // 縮小到 KPW3 完美的相容高度
        backgroundColor: '#FFFFFF',
        color: '#000000',
        fontFamily: 'sans-serif',
        padding: '45px',       // 舒適的內邊距
      }}>
        {/* 頂部標題區 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '6px solid #000000', paddingBottom: '15px', marginBottom: '40px' }}>
          <span style={{ fontSize: '36px', fontWeight: 'bold', letterSpacing: '1px' }}>LLM TOKEN MONITOR</span>
          <span style={{ fontSize: '22px', fontWeight: 'bold' }}>{new Date().toLocaleDateString('zh-TW')}</span>
        </div>

        {/* 區塊：Claude */}
        {showClaude && (
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '30px', border: '4px solid #000000', padding: '25px', borderRadius: '12px' }}>
            <span style={{ fontSize: '24px', fontWeight: 'bold' }}>🤖 Anthropic - Claude Code</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '10px' }}>
              <span style={{ fontSize: '60px', fontWeight: 'bold', lineHeight: '1' }}>{claudeUsage.remaining}</span>
              <span style={{ fontSize: '18px', color: '#555' }}>重置日: {claudeUsage.reset}</span>
            </div>
          </div>
        )}

        {/* 區塊：OpenAI */}
        {showOpenAI && (
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '30px', border: '4px solid #000000', padding: '25px', borderRadius: '12px' }}>
            <span style={{ fontSize: '24px', fontWeight: 'bold' }}>🧠 OpenAI - API Usage</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '10px' }}>
              <span style={{ fontSize: '60px', fontWeight: 'bold', lineHeight: '1' }}>{openAIUsage.remaining}</span>
              <span style={{ fontSize: '18px', color: '#555' }}>重置日: {openAIUsage.reset}</span>
            </div>
          </div>
        )}

        {/* 區塊：Gemini */}
        {showGemini && (
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '30px', border: '4px solid #000000', padding: '25px', borderRadius: '12px' }}>
            <span style={{ fontSize: '24px', fontWeight: 'bold' }}>✨ Google - Gemini API</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '10px' }}>
              <span style={{ fontSize: '60px', fontWeight: 'bold', lineHeight: '1' }}>{geminiUsage.remaining}</span>
              <span style={{ fontSize: '18px', color: '#555' }}>週期: {geminiUsage.reset}</span>
            </div>
          </div>
        )}
        
        {/* 底部提示欄 */}
        <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: '18px', color: '#666' }}>
          ⚡ Kindle Dash System • Auto-Refresh Mode Active
        </div>
      </div>
    ),
    { width: 758, height: 1024 } // 強制 Vercel 輸出 758x1024 格式
  );
}