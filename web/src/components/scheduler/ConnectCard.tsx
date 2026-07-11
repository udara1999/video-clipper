import { useState } from 'react';
import type { SchedulerSettingsView } from '../../../../shared/scheduler';
import { saveAccessToken, testConnection } from '../../lib/schedulerApi';

interface Props {
  settings: SchedulerSettingsView | null;
  onSettingsChange: (settings: SchedulerSettingsView) => void;
}

export function ConnectCard({ settings, onSettingsChange }: Props) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      onSettingsChange(await saveAccessToken(token.trim()));
      setToken('');
      setMessage({ kind: 'ok', text: 'Token saved.' });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const creator = await testConnection();
      setMessage({
        kind: 'ok',
        text: `Connected as ${creator.nickname || creator.username || 'unknown creator'}.`,
      });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const connected = settings?.hasAccessToken ?? false;

  return (
    <div className="panel sched-card">
      <div className="sched-card-head">
        <h2>TikTok account</h2>
        <span className={`sched-chip ${connected ? 'chip-ok' : 'chip-muted'}`}>
          {connected ? `Token set (${settings?.tokenPreview})` : 'Not connected'}
        </span>
      </div>
      <p className="sched-hint">
        Paste an access token with the <code>video.publish</code> scope from your{' '}
        <a href="https://developers.tiktok.com/" target="_blank" rel="noreferrer">
          TikTok developer app
        </a>
        . Unaudited apps can only post privately (Only me).
      </p>
      <div className="sched-token-row">
        <input
          type="password"
          placeholder={connected ? 'Replace access token…' : 'TikTok access token'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
        <button onClick={save} disabled={busy || token.trim() === ''}>
          Save
        </button>
        <button onClick={test} disabled={busy || !connected}>
          Test connection
        </button>
      </div>
      {message && (
        <p className={message.kind === 'error' ? 'error' : 'sched-ok'}>{message.text}</p>
      )}
    </div>
  );
}
