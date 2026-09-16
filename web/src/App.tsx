import { useEffect } from 'react';
import { useSessionStore } from './store/session';
import { StatusBar } from './ui/StatusBar';
import { RecordButton } from './ui/RecordButton';
import { TranscriptStrip } from './ui/TranscriptStrip';
import { InsightCanvas } from './ui/InsightCanvas';
import { DevPanel } from './ui/DevPanel';
import { CostMeter } from './ui/CostMeter';
import { PrintExport } from './ui/PrintExport';

export function App() {
  const connect = useSessionStore((s) => s.connect);
  const error = useSessionStore((s) => s.error);
  const dismissError = useSessionStore((s) => s.dismissError);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(dismissError, 4000);
    return () => clearTimeout(timer);
  }, [error, dismissError]);

  return (
    <div className="app">
      <StatusBar />
      <DevPanel />
      <InsightCanvas />
      <TranscriptStrip />
      <RecordButton />
      <CostMeter />
      <PrintExport />
      {error && <div className="error-toast">{error}</div>}
    </div>
  );
}
