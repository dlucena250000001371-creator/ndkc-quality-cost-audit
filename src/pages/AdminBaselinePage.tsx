import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Eye, FileCheck2, FilePlus2, FileText, Trash2, Upload } from 'lucide-react';
import {
  OperationType,
  db,
  handleFirestoreError,
  stripUndefined,
  withTimeout,
} from '../lib/firebase';
import { ModalDialog } from '../components/ModalDialog';
import {
  MAX_BASELINE_FILE_BYTES,
  MAX_BASELINE_TOTAL_CHARS,
  type BaselineDoc,
} from '../types/audit';

interface AdminBaselinePageProps {
  uid: string;
  onNotify: (toast: {
    type: 'error' | 'success' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

function extractTitleFromMarkdown(text: string, fallbackName: string): string {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#+\s+/.test(trimmed)) {
      return trimmed.replace(/^#+\s+/, '').trim() || fallbackName;
    }
  }
  return fallbackName;
}

export function AdminBaselinePage({ uid, onNotify }: AdminBaselinePageProps) {
  const [documents, setDocuments] = useState<BaselineDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [viewingDoc, setViewingDoc] = useState<BaselineDoc | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<BaselineDoc | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLoading(true);
    const ref = doc(db, 'settings', 'qualityBaseline');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const list = Array.isArray(data?.documents) ? (data.documents as BaselineDoc[]) : [];
          setDocuments(list);
        } else {
          setDocuments([]);
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        onNotify({ type: 'error', message: 'Could not load quality baseline documents.' });
        handleFirestoreError(err, OperationType.GET, 'settings/qualityBaseline');
      }
    );
    return () => unsub();
  }, [onNotify]);

  const totalChars = useMemo(
    () => documents.reduce((acc, d) => acc + (d.sizeChars || d.text?.length || 0), 0),
    [documents]
  );

  const persistDocuments = async (nextDocs: BaselineDoc[], successMessage: string) => {
    const nextTotal = nextDocs.reduce((acc, d) => acc + (d.sizeChars || d.text.length), 0);
    if (nextTotal > MAX_BASELINE_TOTAL_CHARS) {
      setUploadError(
        `Total baseline text (${nextTotal.toLocaleString()} chars) exceeds the ${MAX_BASELINE_TOTAL_CHARS.toLocaleString()} character limit.`
      );
      return false;
    }

    setSaving(true);
    setUploadError(null);
    try {
      await withTimeout(
        setDoc(
          doc(db, 'settings', 'qualityBaseline'),
          stripUndefined({
            documents: nextDocs,
            updatedAt: serverTimestamp(),
            updatedBy: uid,
          })
        ),
        15000,
        'Saving quality baseline timed out.'
      );
      onNotify({ type: 'success', message: successMessage });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save quality baseline.';
      setUploadError(msg);
      onNotify({ type: 'error', message: msg });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    const additions: BaselineDoc[] = [];

    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith('.md') && !lowerName.endsWith('.txt')) {
        setUploadError(`Refused "${file.name}": only .md or .txt files are allowed.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      if (file.size > MAX_BASELINE_FILE_BYTES) {
        setUploadError(
          `Refused "${file.name}": file exceeds the 200 KB (${MAX_BASELINE_FILE_BYTES.toLocaleString()} bytes) limit.`
        );
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const text = await file.text();
      if (!text.trim()) {
        setUploadError(`Refused "${file.name}": file is empty.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const title = extractTitleFromMarkdown(text, file.name);
      additions.push({
        id: crypto.randomUUID(),
        title,
        text, // Kept verbatim as uploaded
        sizeChars: text.length,
        uploadedAt: new Date().toISOString(),
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (additions.length > 0) {
      await persistDocuments(
        [...documents, ...additions],
        `Added ${additions.length} baseline document${additions.length > 1 ? 's' : ''}.`
      );
    }
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);

    const trimmedTitle = pasteTitle.trim();
    if (!trimmedTitle) {
      setUploadError('Please enter a title for the pasted baseline document.');
      return;
    }
    if (!pasteText.trim()) {
      setUploadError('Please paste the baseline document text.');
      return;
    }
    if (new Blob([pasteText]).size > MAX_BASELINE_FILE_BYTES) {
      setUploadError('Pasted text exceeds the 200 KB per-document limit.');
      return;
    }

    const newDoc: BaselineDoc = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      text: pasteText, // Kept verbatim
      sizeChars: pasteText.length,
      uploadedAt: new Date().toISOString(),
    };

    const ok = await persistDocuments([...documents, newDoc], `Added "${trimmedTitle}".`);
    if (ok) {
      setPasteTitle('');
      setPasteText('');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingDoc) return;
    const target = deletingDoc;
    setDeletingDoc(null);
    const nextDocs = documents.filter((d) => d.id !== target.id);
    await persistDocuments(nextDocs, `Removed "${target.title}".`);
  };

  const usagePct = Math.min(100, Math.round((totalChars / MAX_BASELINE_TOTAL_CHARS) * 100));

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center shrink-0 mt-0.5">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">NDKC Quality Baseline</h1>
            <p className="text-sm text-slate-600">
              Upload NDKC quality standards (.md or .txt, max 200 KB per file, 800,000 characters
              total). Codes such as AC-3 and QC-2 are referenced by the Audit Partner.
            </p>
          </div>
        </div>
        <div className="text-right tabular-nums shrink-0">
          <div className="text-xs font-semibold text-slate-500">Total Baseline Size</div>
          <div className="text-sm font-extrabold text-slate-900">
            {totalChars.toLocaleString()} / {MAX_BASELINE_TOTAL_CHARS.toLocaleString()} chars (
            {usagePct}%)
          </div>
        </div>
      </div>

      {uploadError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-900 font-semibold"
        >
          {uploadError}
        </div>
      )}

      {/* Upload & Paste Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-4 animate-fade-rise">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center shrink-0">
              <Upload className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900">Upload .md or .txt File</h2>
          </div>
          <p className="text-sm text-slate-600">
            The document title is taken from its first Markdown heading line (or the filename if no
            heading exists). Text is preserved verbatim.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            multiple
            disabled={saving}
            onChange={(e) => void handleFilesSelected(e)}
            className="block w-full text-sm text-slate-700 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-[#1E40AF] file:text-white hover:file:bg-blue-900 file:cursor-pointer"
          />
        </div>

        <form
          onSubmit={(e) => void handlePasteSubmit(e)}
          className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-3 animate-fade-rise"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-orange-50 text-[#F97316] flex items-center justify-center shrink-0">
              <FilePlus2 className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900">Paste Baseline Text</h2>
          </div>
          <input
            type="text"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
            placeholder="Document title (e.g., Academic Quality Standards)"
            maxLength={150}
            className="w-full px-3.5 py-2 text-sm border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
          />
          <textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste baseline standard text including codes like AC-3, AD-1, QC-2..."
            className="w-full px-3.5 py-2 text-sm border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="btn-coral px-4 py-2 disabled:opacity-60 text-sm font-bold rounded-xl transition-colors cursor-pointer"
            >
              {saving ? 'Saving...' : 'Add Pasted Document'}
            </button>
          </div>
        </form>
      </div>

      {/* Stored Baseline Documents List */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden animate-fade-rise">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#1E40AF]" />
          <h2 className="text-base font-extrabold text-slate-900">
            Uploaded Baseline Documents ({documents.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        ) : documents.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center mx-auto">
              <FileText className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-extrabold text-slate-900">
                No baseline documents uploaded yet
              </p>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Upload NDKC quality documents so the Audit Partner can link employee answers to
                official standards.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-royal px-4 py-2 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Choose .md or .txt File
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {documents.map((docItem) => (
              <div
                key={docItem.id}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{docItem.title}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {docItem.sizeChars.toLocaleString()} chars · Uploaded{' '}
                    {new Date(docItem.uploadedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setViewingDoc(docItem)}
                    className="px-3 py-1.5 text-xs font-bold text-[#1E40AF] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingDoc(docItem)}
                    className="px-3 py-1.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Baseline Document Modal */}
      <ModalDialog
        open={Boolean(viewingDoc)}
        title={viewingDoc?.title || 'Baseline Document'}
        onClose={() => setViewingDoc(null)}
        maxWidthClass="max-w-3xl"
      >
        {viewingDoc && (
          <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap bg-slate-50 border border-[#E2E8F0] rounded-xl p-4 max-h-[65vh] overflow-y-auto">
            {viewingDoc.text}
          </pre>
        )}
      </ModalDialog>

      {/* Delete Confirmation Modal */}
      <ModalDialog
        open={Boolean(deletingDoc)}
        title="Delete Baseline Document?"
        onClose={() => setDeletingDoc(null)}
      >
        {deletingDoc && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Remove <strong>{deletingDoc.title}</strong> from the NDKC quality baseline? Future
              interviews and sheets will no longer reference its codes.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingDoc(null)}
                className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl"
              >
                Delete Document
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
