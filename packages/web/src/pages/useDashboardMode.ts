import { useState } from 'react';

/*
 * What the dashboard header is doing: nothing, naming a new group, or selecting several.
 *
 * These were separate pieces of state that every transition had to remember to reset, and the two
 * modes are mutually exclusive for a real reason — select mode hides the New button, so leaving
 * both open strands the name field under the selection UI with no way back. Keeping them in one
 * place makes that structural instead of something each handler has to get right.
 */
export interface DashboardMode {
  creatingOpen: boolean;
  name: string;
  setName: (value: string) => void;
  /** Set once the field has been touched, so "needs a name" appears on demand rather than as a
      scolding the instant the form opens. */
  nameTouched: boolean;
  touchName: () => void;
  openCreate: () => void;
  closeCreate: () => void;

  selectMode: boolean;
  selected: ReadonlySet<string>;
  toggleSelected: (id: string) => void;
  enterSelect: () => void;
  exitSelect: () => void;
}

export function useDashboardMode(onLeaveCreate: () => void): DashboardMode {
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const closeCreate = (): void => {
    setCreatingOpen(false);
    setName('');
    setNameTouched(false);
    onLeaveCreate();
  };

  const exitSelect = (): void => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return {
    creatingOpen,
    name,
    setName,
    nameTouched,
    touchName: () => setNameTouched(true),
    openCreate: () => {
      exitSelect();
      setNameTouched(false);
      onLeaveCreate();
      setCreatingOpen(true);
    },
    closeCreate,
    selectMode,
    selected,
    toggleSelected: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    enterSelect: () => {
      closeCreate();
      setSelectMode(true);
    },
    exitSelect,
  };
}
