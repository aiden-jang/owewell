import { useState } from 'react';

// Creation and selection are mutually exclusive so neither mode can hide the other's controls.
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

/** `onCreateToggled` fires whenever the name field opens or closes, which is when the page wants
    anything it was showing about the last attempt cleared. */
export function useDashboardMode(onCreateToggled: () => void): DashboardMode {
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const closeCreate = (): void => {
    setCreatingOpen(false);
    setName('');
    setNameTouched(false);
    onCreateToggled();
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
      onCreateToggled();
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
