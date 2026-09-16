import { useSessionStore } from '../store/session';

export function TranscriptStrip() {
  const transcript = useSessionStore((s) => s.transcript);

  if (transcript.length === 0) return null;

  return (
    <div className="transcript-strip">
      {transcript.map((line) => (
        <div key={line.id} className={`transcript-strip__line ${line.isFinal ? '' : 'transcript-strip__line--interim'}`}>
          {line.text}
        </div>
      ))}
    </div>
  );
}
