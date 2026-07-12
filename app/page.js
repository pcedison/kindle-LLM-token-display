'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildManagedUrls,
  formatRefreshOption,
  normalizeArtworkFile,
} from './configClient.mjs';

const PROFILES = [
  { value: 'dp75sdi', label: 'DP75SDI / Paperwhite 2 (758 x 1024)' },
  { value: 'kpw3', label: 'Paperwhite 3 (1072 x 1448)' },
  { value: 'voyage', label: 'Voyage (1080 x 1440)' },
  { value: 'basic', label: 'Kindle Basic (600 x 800)' },
];

const REFRESH_INTERVALS = [
  10, 20, 30, 40, 50, 60, 120, 180, 240, 300,
  360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
];

const PROVIDERS = [
  { key: 'claude', label: 'Anthropic / Claude' },
  { key: 'openai', label: 'OpenAI / Codex' },
  { key: 'gemini', label: 'Google / Gemini' },
];

const ARTWORK_PROVIDERS = [
  {
    key: 'claude',
    label: 'Claude artwork',
    help: 'Used on the Claude quota panel.',
  },
  {
    key: 'openai',
    label: 'OpenAI artwork',
    help: 'Used on the Codex quota panel.',
  },
];

const EMPTY_ARTWORK_STATE = {
  claude: { processing: false, error: '' },
  openai: { processing: false, error: '' },
};

function responseMessage(status, fallback) {
  if (status === 401) return '管理密碼不正確。';
  if (status === 503) return '此部署尚未設定管理功能。';
  if (status === 413) return '設定內容過大，請恢復其中一張預設圖後再試。';
  return fallback;
}

export default function ConfigPage() {
  const [profile, setProfile] = useState('dp75sdi');
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [draft, setDraft] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [saveError, setSaveError] = useState('');
  const [artworkState, setArtworkState] = useState(EMPTY_ARTWORK_STATE);
  const [viewToken, setViewToken] = useState('');
  const [origin, setOrigin] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const sessionRef = useRef(0);
  const passwordRef = useRef(null);
  const unlockErrorRef = useRef(null);
  const saveErrorRef = useRef(null);
  const previewErrorRef = useRef(null);
  const artworkErrorRefs = useRef({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const managedUrls = useMemo(
    () => (origin ? buildManagedUrls({ origin, profile, viewToken }) : null),
    [origin, profile, viewToken],
  );

  useEffect(() => {
    setPreviewFailed(false);
  }, [managedUrls?.dashboardUrl, draft?.updatedAt]);

  useEffect(() => {
    if (!draft) passwordRef.current?.focus();
  }, [draft]);

  useEffect(() => {
    if (unlockError) unlockErrorRef.current?.focus();
  }, [unlockError]);

  useEffect(() => {
    if (saveError) saveErrorRef.current?.focus();
  }, [saveError]);

  useEffect(() => {
    const provider = ARTWORK_PROVIDERS.find(
      (item) => artworkState[item.key].error,
    );
    if (provider) artworkErrorRefs.current[provider.key]?.focus();
  }, [artworkState]);

  useEffect(() => {
    if (previewFailed) previewErrorRef.current?.focus();
  }, [previewFailed]);

  const updateDraft = (update) => {
    setDraft((current) => (current ? update(current) : current));
    setSaveState('unsaved');
    setSaveError('');
  };

  const unlock = async (event) => {
    event.preventDefault();
    if (!password || unlocking) return;

    setUnlocking(true);
    setUnlockError('');
    try {
      const response = await fetch(`/api/config?profile=${encodeURIComponent(profile)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${password}` },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(responseMessage(response.status, '無法載入遠端設定。'));
      }

      const config = await response.json();
      sessionRef.current += 1;
      setAdminToken(password);
      setPassword('');
      setDraft(config);
      setSaveState('saved');
      setArtworkState(EMPTY_ARTWORK_STATE);
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : '無法載入遠端設定。');
    } finally {
      setUnlocking(false);
    }
  };

  const lock = () => {
    sessionRef.current += 1;
    setAdminToken('');
    setPassword('');
    setDraft(null);
    setViewToken('');
    setUnlockError('');
    setSaveError('');
    setSaveState('saved');
    setArtworkState(EMPTY_ARTWORK_STATE);
  };

  const setProviderVisible = (provider, visible) => {
    updateDraft((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: { ...current.providers[provider], visible },
      },
    }));
  };

  const setArtwork = (provider, imageDataUrl) => {
    updateDraft((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: { ...current.providers[provider], imageDataUrl },
      },
    }));
  };

  const uploadArtwork = async (provider, event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const session = sessionRef.current;
    setArtworkState((current) => ({
      ...current,
      [provider]: { processing: true, error: '' },
    }));
    try {
      const imageDataUrl = await normalizeArtworkFile(file);
      if (session !== sessionRef.current) return;
      setArtwork(provider, imageDataUrl);
    } catch (error) {
      if (session !== sessionRef.current) return;
      setArtworkState((current) => ({
        ...current,
        [provider]: {
          processing: false,
          error: error instanceof Error ? error.message : '無法處理這張圖片。',
        },
      }));
    } finally {
      input.value = '';
      if (session === sessionRef.current) {
        setArtworkState((current) => ({
          ...current,
          [provider]: { ...current[provider], processing: false },
        }));
      }
    }
  };

  const saveConfig = async (event) => {
    event.preventDefault();
    if (!draft || !adminToken || saveState === 'saving') return;

    const session = sessionRef.current;
    setSaveState('saving');
    setSaveError('');
    try {
      const response = await fetch(`/api/config?profile=${encodeURIComponent(profile)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshIntervalSeconds: draft.refreshIntervalSeconds,
          providers: {
            claude: draft.providers.claude,
            openai: draft.providers.openai,
            gemini: { visible: draft.providers.gemini.visible },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(responseMessage(response.status, '儲存失敗，遠端設定未變更。'));
      }

      const saved = await response.json();
      if (session !== sessionRef.current) return;
      setDraft(saved);
      setSaveState('saved');
    } catch (error) {
      if (session !== sessionRef.current) return;
      setSaveState('unsaved');
      setSaveError(error instanceof Error ? error.message : '儲存失敗，遠端設定未變更。');
    }
  };

  const artworkBusy = Object.values(artworkState).some((item) => item.processing);
  const saving = saveState === 'saving';

  return (
    <main className="console-main">
      <div className="console-shell">
        <header className="console-header">
          <div>
            <p className="console-kicker">REMOTE SETTINGS</p>
            <h1>Kindle LLM Token Dashboard</h1>
          </div>
          <p className="console-intro">
            從瀏覽器管理 Kindle 顯示內容、面板圖像與更新頻率。
          </p>
        </header>

        {!draft ? (
          <form className="unlock-band" onSubmit={unlock}>
            <div className="field-group">
              <label htmlFor="profile">Kindle profile</label>
              <select
                id="profile"
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
                disabled={unlocking}
              >
                {PROFILES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="admin-token">管理密碼</label>
              <input
                id="admin-token"
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                aria-invalid={Boolean(unlockError)}
                aria-describedby={unlockError ? 'unlock-error' : undefined}
                disabled={unlocking}
                required
              />
            </div>
            <button className="primary-button unlock-button" type="submit" disabled={!password || unlocking}>
              {unlocking ? 'Unlocking...' : 'Unlock'}
            </button>
            {unlockError ? (
              <p
                id="unlock-error"
                ref={unlockErrorRef}
                className="form-error unlock-error"
                role="alert"
                tabIndex={-1}
              >
                {unlockError}
              </p>
            ) : null}
          </form>
        ) : (
          <>
            <section className="session-band" aria-label="Unlocked session">
              <div>
                <span className="session-label">UNLOCKED PROFILE</span>
                <strong>{PROFILES.find((item) => item.value === profile)?.label}</strong>
              </div>
              <button className="lock-button" type="button" onClick={lock}>Lock</button>
            </section>

            <form className="editor-form" onSubmit={saveConfig}>
              <fieldset className="settings-band" disabled={saving}>
                <legend>Providers</legend>
                <p className="band-note">Choose which quota panels appear in the managed PNG.</p>
                <div className="provider-grid">
                  {PROVIDERS.map((provider) => (
                    <label className="check-row" key={provider.key}>
                      <input
                        type="checkbox"
                        checked={draft.providers[provider.key].visible}
                        onChange={(event) => setProviderVisible(provider.key, event.target.checked)}
                      />
                      <span>{provider.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="settings-band artwork-band" disabled={saving}>
                <legend>Artwork</legend>
                <p className="band-note">
                  PNG, JPEG, or WebP up to 5 MiB. Each image is placed on white at exactly 104 x 96.
                </p>
                <div className="artwork-grid">
                  {ARTWORK_PROVIDERS.map((provider) => {
                    const imageDataUrl = draft.providers[provider.key].imageDataUrl;
                    const state = artworkState[provider.key];
                    const helpId = `${provider.key}-artwork-help`;
                    return (
                      <article className="artwork-workspace" key={provider.key}>
                        <div className="artwork-heading">
                          <div>
                            <h2>{provider.label}</h2>
                            <p id={helpId}>{provider.help}</p>
                          </div>
                          <div className="artwork-preview-frame">
                            <img
                              src={imageDataUrl || '/pikachu-line.png'}
                              width="104"
                              height="96"
                              alt={`${provider.label} preview`}
                            />
                          </div>
                        </div>
                        <div className="artwork-controls">
                          <label htmlFor={`${provider.key}-artwork`}>Upload image</label>
                          <input
                            id={`${provider.key}-artwork`}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            aria-invalid={Boolean(state.error)}
                            aria-describedby={state.error ? `${helpId} ${provider.key}-artwork-error` : helpId}
                            onChange={(event) => uploadArtwork(provider.key, event)}
                            disabled={state.processing || saving}
                          />
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => setArtwork(provider.key, null)}
                            disabled={!imageDataUrl || state.processing || saving}
                          >
                            Restore Default
                          </button>
                        </div>
                        {state.processing ? <p className="inline-status" role="status">Converting to PNG...</p> : null}
                        {state.error ? (
                          <p
                            id={`${provider.key}-artwork-error`}
                            ref={(node) => {
                              artworkErrorRefs.current[provider.key] = node;
                            }}
                            className="form-error"
                            role="alert"
                            tabIndex={-1}
                          >
                            {state.error}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="settings-band refresh-band" disabled={saving}>
                <legend>Refresh</legend>
                <div className="refresh-layout">
                  <div className="field-group">
                    <label htmlFor="refresh-interval">Kindle refresh interval</label>
                    <select
                      id="refresh-interval"
                      value={draft.refreshIntervalSeconds}
                      onChange={(event) => updateDraft((current) => ({
                        ...current,
                        refreshIntervalSeconds: Number(event.target.value),
                      }))}
                    >
                      {REFRESH_INTERVALS.map((seconds) => (
                        <option key={seconds} value={seconds}>{formatRefreshOption(seconds)}</option>
                      ))}
                    </select>
                  </div>
                  <p className="power-note">
                    10-50 秒會明顯增加 Wi-Fi 與螢幕更新耗電；12 分鐘為建議設定。
                  </p>
                </div>
              </fieldset>

              <section className="save-band" aria-label="Save settings">
                <div className="save-state" aria-live="polite">
                  <span className={`status-mark status-${saveState}`} aria-hidden="true" />
                  <div>
                    <strong>
                      {saveState === 'saving' ? 'Saving' : saveState === 'unsaved' ? 'Unsaved changes' : 'Saved'}
                    </strong>
                    <span>{saveState === 'saved' ? `Updated ${new Date(draft.updatedAt).toLocaleString()}` : 'Remote settings are unchanged.'}</span>
                  </div>
                </div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={saveState !== 'unsaved' || artworkBusy}
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
                {saveError ? (
                  <p
                    ref={saveErrorRef}
                    className="form-error save-error"
                    role="alert"
                    tabIndex={-1}
                  >
                    {saveError}
                  </p>
                ) : null}
              </section>
            </form>

            <fieldset className="settings-band urls-band">
              <legend>Managed URLs</legend>
              <div className="field-group view-token-field">
                <label htmlFor="view-token">View key (optional)</label>
                <input
                  id="view-token"
                  type="password"
                  value={viewToken}
                  onChange={(event) => setViewToken(event.target.value)}
                  autoComplete="off"
                  aria-invalid={previewFailed}
                  aria-describedby={previewFailed ? 'preview-error' : undefined}
                  placeholder="DASHBOARD_VIEW_TOKEN"
                />
              </div>
              {managedUrls ? (
                <div className="url-list">
                  <div className="url-row">
                    <div>
                      <strong>Managed PNG</strong>
                      <code>{managedUrls.dashboardUrl}</code>
                    </div>
                    <a href={managedUrls.dashboardUrl} target="_blank" rel="noreferrer">Open</a>
                  </div>
                  <div className="url-row">
                    <div>
                      <strong>Device config</strong>
                      <code>{managedUrls.deviceConfigUrl}</code>
                    </div>
                    <a href={managedUrls.deviceConfigUrl} target="_blank" rel="noreferrer">Open</a>
                  </div>
                </div>
              ) : <p className="band-note">Preparing deployment URLs...</p>}
            </fieldset>

            <section className="preview-band" aria-labelledby="preview-title">
              <div className="preview-heading">
                <div>
                  <p className="console-kicker">LIVE OUTPUT</p>
                  <h2 id="preview-title">Complete PNG preview</h2>
                </div>
                <span>{profile}</span>
              </div>
              {managedUrls ? (
                <div className="full-preview-stage">
                  <img
                    key={`${managedUrls.dashboardUrl}-${draft.updatedAt}`}
                    src={managedUrls.dashboardUrl}
                    alt={`Complete managed dashboard preview for ${profile}`}
                    onLoad={() => setPreviewFailed(false)}
                    onError={() => setPreviewFailed(true)}
                  />
                </div>
              ) : null}
              {previewFailed ? (
                <p
                  id="preview-error"
                  ref={previewErrorRef}
                  className="form-error preview-error"
                  role="alert"
                  tabIndex={-1}
                >
                  Preview unavailable. Check the view key or open the managed PNG URL directly.
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
