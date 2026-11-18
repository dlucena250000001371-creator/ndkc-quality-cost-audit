import { useMemo } from 'react';
import { renderSafeMarkdown } from '../lib/markdown';

export function MarkdownContent({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderSafeMarkdown(text), [text]);
  return (
    <div
      className={`markdown-body text-slate-800 leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
