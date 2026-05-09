'use client';

import { useRef, useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  createNoteAction,
  updateNoteAction,
  deleteNoteAction,
} from '../actions';

type Author = { id: string; name: string };
type Note = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  author: Author;
  createdAt: Date;
  updatedAt: Date;
};
type Perms = { canCreate: boolean; canUpdate: boolean; canDelete: boolean };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(date: Date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(date).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// NoteCard
// ---------------------------------------------------------------------------
function NoteCard({
  note,
  currentUserId,
  perms,
  onDeleted,
}: {
  note: Note;
  currentUserId: string;
  perms: Perms;
  onDeleted: (id: string) => void;
}) {
  const [editing,    setEditing]    = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [editError,  setEditError]  = useState('');
  const [isPending,  startTransition] = useTransition();
  const titleRef   = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const isAuthor   = note.authorId === currentUserId;
  const canEdit    = perms.canUpdate && isAuthor;  // operators: own only; admins: any (handled server-side)
  const showDelete = perms.canDelete;               // admin+ only

  const handleUpdate = () => {
    setEditError('');
    const fd = new FormData();
    fd.append('title',   titleRef.current?.value   ?? note.title);
    fd.append('content', contentRef.current?.value ?? note.content);
    startTransition(async () => {
      const res = await updateNoteAction(note.id, fd);
      if (res?.error) { setEditError(res.error); return; }
      setEditing(false);
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    startTransition(async () => {
      const res = await deleteNoteAction(note.id);
      if (res?.error) { alert(res.error); setDeleting(false); return; }
      onDeleted(note.id);
    });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: deleting ? 0 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm"
    >
      {editing ? (
        <div className="space-y-3">
          <input
            ref={titleRef}
            defaultValue={note.title}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm font-medium outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            placeholder="Title"
            maxLength={200}
          />
          <textarea
            ref={contentRef}
            defaultValue={note.content}
            rows={5}
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none"
            placeholder="Content…"
            maxLength={5000}
          />
          {editError && <p className="text-xs text-red-400">{editError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleUpdate}
              disabled={isPending}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setEditError(''); }}
              className="px-3 py-1.5 bg-secondary rounded-lg text-xs hover:bg-secondary/80"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-semibold text-[15px] leading-snug">{note.title}</h3>
            <div className="flex items-center gap-1.5 shrink-0">
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground border border-border/50 hover:bg-muted/80 transition-colors"
                >
                  Edit
                </button>
              )}
              {showDelete && (
                <button
                  onClick={handleDelete}
                  disabled={isPending}
                  className="text-xs px-2 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {note.content}
          </p>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
            <span className="text-[11px] text-muted-foreground/70">
              by <span className="text-foreground/70">{note.author.name}</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-[11px] text-muted-foreground/70">{timeAgo(note.createdAt)}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// CreateNoteForm
// ---------------------------------------------------------------------------
function CreateNoteForm({ onCreated }: { onCreated: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [error,   setError]   = useState('');
  const [isPending, start]    = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(formRef.current!);
    start(async () => {
      const res = await createNoteAction(fd);
      if (res?.error) { setError(res.error); return; }
      formRef.current?.reset();
      setOpen(false);
      onCreated();
    });
  };

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Note
        </button>
      ) : (
        <motion.form
          ref={formRef}
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-primary/20 rounded-2xl p-5 shadow-sm space-y-3"
        >
          <h3 className="text-sm font-semibold">New Note</h3>
          <input
            name="title"
            required
            maxLength={200}
            placeholder="Title"
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm font-medium outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
          />
          <textarea
            name="content"
            required
            rows={4}
            maxLength={5000}
            placeholder="Write your note…"
            className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 resize-none"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Creating…' : 'Create Note'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(''); }}
              className="px-4 py-2 bg-secondary rounded-xl text-xs hover:bg-secondary/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </motion.form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotesClient  — main export
// ---------------------------------------------------------------------------
export function NotesClient({
  notes: initialNotes,
  currentUserId,
  perms,
}: {
  notes: Note[];
  currentUserId: string;
  perms: Perms;
}) {
  const [notes, setNotes] = useState(initialNotes);

  const handleDeleted = (id: string) => setNotes(prev => prev.filter(n => n.id !== id));

  return (
    <div className="space-y-4">
      {/* Create button — only shown when permitted */}
      {perms.canCreate && (
        <CreateNoteForm onCreated={() => window.location.reload()} />
      )}

      {/* Notes list */}
      <AnimatePresence mode="popLayout">
        {notes.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 text-muted-foreground"
          >
            <div className="text-4xl mb-3">📝</div>
            <p className="text-sm">No notes yet.</p>
            {perms.canCreate && (
              <p className="text-xs mt-1 text-muted-foreground/60">Click "New Note" to get started.</p>
            )}
          </motion.div>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              perms={perms}
              onDeleted={handleDeleted}
            />
          ))
        )}
      </AnimatePresence>
    </div>
  );
}
