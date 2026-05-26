'use client';

import { useRef, useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  createNoteAction,
  updateNoteAction,
  deleteNoteAction,
} from '../actions';
import { ActionDialog } from '../../../_components/ActionDialog';
import { type ToastKind } from '../../../_components/ToastRegion';
import { useToast } from '../../../../lib/toast-context';

type Author = { id: string; name: string };
type Note = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  author: Author;
  createdAt: Date | string;
  updatedAt: Date | string;
};
type Perms = {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canListAll: boolean;
};

type ToastApi = {
  pushToast: (kind: ToastKind, message: string) => void;
};

const EDIT_TITLE_INPUT_ID = 'note-edit-title';
const EDIT_CONTENT_INPUT_ID = 'note-edit-content';
const CREATE_TITLE_INPUT_ID = 'note-create-title';
const CREATE_CONTENT_INPUT_ID = 'note-create-content';

function timeAgo(date: Date | string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(date).toLocaleDateString();
}

type NoteCardProps = {
  note: Note;
  currentUserId: string;
  perms: Perms;
  isAdmin: boolean;
  onDeleted: (id: string) => void;
  onUpdated: (id: string, title: string, content: string) => void;
  toastApi: ToastApi;
};

function NoteCard({
  note,
  currentUserId,
  perms,
  isAdmin,
  onDeleted,
  onUpdated,
  toastApi,
}: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const isAuthor = note.authorId === currentUserId;
  const canEdit = perms.canUpdate && (isAuthor || isAdmin);
  const showDelete = perms.canDelete;

  const handleUpdate = () => {
    setEditError('');
    const title = (titleRef.current?.value ?? note.title).trim();
    const content = (contentRef.current?.value ?? note.content).trim();

    if (!title) {
      setEditError('Title is required.');
      return;
    }
    if (!content) {
      setEditError('Content is required.');
      return;
    }

    const fd = new FormData();
    fd.append('title', title);
    fd.append('content', content);

    startTransition(async () => {
      const res = await updateNoteAction(note.id, fd);
      if (res?.error) {
        setEditError(res.error);
        toastApi.pushToast('error', res.error);
        return;
      }
      onUpdated(note.id, title, content);
      setEditing(false);
      toastApi.pushToast('success', 'Note updated.');
    });
  };

  const handleDelete = () => {
    // Don't fade the card until the server confirms deletion. Previously we
    // optimistically set `deleting=true` which made the UI lie when the
    // request failed (the user briefly saw the note disappear).
    startTransition(async () => {
      const res = await deleteNoteAction(note.id);
      if (res?.error) {
        toastApi.pushToast('error', res.error);
        return;
      }
      setDeleting(true);
      onDeleted(note.id);
      toastApi.pushToast('success', 'Note deleted.');
    });
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: deleting ? 0 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm sm:p-5"
    >
      {editing ? (
        <div className="space-y-3">
          <label
            htmlFor={`${EDIT_TITLE_INPUT_ID}-${note.id}`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Title
          </label>
          <input
            id={`${EDIT_TITLE_INPUT_ID}-${note.id}`}
            ref={titleRef}
            defaultValue={note.title}
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-primary/50"
            placeholder="Title"
            maxLength={200}
          />
          <label
            htmlFor={`${EDIT_CONTENT_INPUT_ID}-${note.id}`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Content
          </label>
          <textarea
            id={`${EDIT_CONTENT_INPUT_ID}-${note.id}`}
            ref={contentRef}
            defaultValue={note.content}
            rows={5}
            className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
            placeholder="Content"
            maxLength={5000}
          />
          {editError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {editError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={isPending}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditError('');
              }}
              className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold leading-snug text-foreground">
              {note.title}
            </h3>
            <div className="flex shrink-0 items-center gap-1.5">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/40"
                >
                  Edit
                </button>
              ) : null}
              {showDelete ? (
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  disabled={isPending}
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-60"
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {note.content}
          </p>
          <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
            <span className="text-[11px] text-muted-foreground">
              by <span className="text-foreground/80">{note.author.name}</span>
            </span>
            <span className="text-muted-foreground/40">-</span>
            <span className="text-[11px] text-muted-foreground">
              {timeAgo(note.createdAt)}
            </span>
          </div>
        </>
      )}

      <ActionDialog
        open={deleteOpen}
        title="Delete note"
        description={`Delete "${note.title}" permanently? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        pending={isPending}
        onConfirm={handleDelete}
        onClose={() => {
          if (isPending) return;
          setDeleteOpen(false);
        }}
      />
    </motion.article>
  );
}

function CreateNoteForm({
  onCreated,
  toastApi,
}: {
  onCreated: (note: Note) => void;
  toastApi: ToastApi;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [isPending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const form = formRef.current;
    if (!form) return;

    const fd = new FormData(form);
    const title = ((fd.get('title') as string) ?? '').trim();
    const content = ((fd.get('content') as string) ?? '').trim();

    if (!title || !content) {
      setError('Title and content are required.');
      return;
    }

    start(async () => {
      const res = await createNoteAction(fd);
      if (res?.error) {
        setError(res.error);
        toastApi.pushToast('error', res.error);
        return;
      }

      if (res && typeof res === 'object' && 'note' in res && res.note) {
        onCreated(res.note as Note);
      }

      form.reset();
      setOpen(false);
      toastApi.pushToast('success', 'Note created.');
    });
  };

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Note
        </button>
      ) : (
        <motion.form
          ref={formRef}
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm"
        >
          <h3 className="text-sm font-semibold text-foreground">Create Note</h3>
          <label
            htmlFor={CREATE_TITLE_INPUT_ID}
            className="block text-xs font-medium text-muted-foreground"
          >
            Title
          </label>
          <input
            id={CREATE_TITLE_INPUT_ID}
            name="title"
            required
            maxLength={200}
            placeholder="Title"
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-primary/50"
          />
          <label
            htmlFor={CREATE_CONTENT_INPUT_ID}
            className="block text-xs font-medium text-muted-foreground"
          >
            Content
          </label>
          <textarea
            id={CREATE_CONTENT_INPUT_ID}
            name="content"
            required
            rows={4}
            maxLength={5000}
            placeholder="Write your note"
            className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          />
          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
            >
              {isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError('');
              }}
              className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </motion.form>
      )}
    </div>
  );
}

function ViewHint({ perms }: { perms: Perms }) {
  if (perms.canDelete) {
    return (
      <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
        Scope: all notes (super admin)
      </div>
    );
  }
  if (perms.canListAll) {
    return (
      <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
        Scope: all notes (admin or operator)
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
      Scope: your notes
    </div>
  );
}

export function NotesClient({
  notes: initialNotes,
  currentUserId,
  perms,
  isAdmin,
}: {
  notes: Note[];
  currentUserId: string;
  perms: Perms;
  isAdmin: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const { pushToast } = useToast();

  const handleDeleted = (id: string) =>
    setNotes((prev) => prev.filter((note) => note.id !== id));

  const handleUpdated = (id: string, title: string, content: string) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === id
          ? {
              ...note,
              title,
              content,
              updatedAt: new Date(),
            }
          : note,
      ),
    );
  };

  const handleCreated = (note: Note) => {
    setNotes((prev) => [note, ...prev]);
  };

  return (
    <>
      <div className="space-y-4">
        <ViewHint perms={perms} />

        {perms.canCreate ? (
          <CreateNoteForm onCreated={handleCreated} toastApi={{ pushToast }} />
        ) : null}

        <AnimatePresence mode="popLayout">
          {notes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed border-border/70 bg-card/40 py-14 text-center"
            >
              <p className="text-sm font-medium text-foreground">
                No notes yet
              </p>
              {perms.canCreate ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Create your first note to get started.
                </p>
              ) : null}
            </motion.div>
          ) : (
            notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                currentUserId={currentUserId}
                perms={perms}
                isAdmin={isAdmin}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
                toastApi={{ pushToast }}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
