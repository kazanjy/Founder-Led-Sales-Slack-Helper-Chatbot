"use client";

import { useState, useCallback } from "react";
import ConfirmModal from "./ConfirmModal";

type ModalVariant = "danger" | "warning" | "info";

interface ModalOptions {
  title: string;
  message: string;
  variant?: ModalVariant;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface AlertOptions {
  title: string;
  message: string;
  variant?: ModalVariant;
  confirmLabel?: string;
}

export function useConfirmModal() {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    options: ModalOptions;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    options: { title: "", message: "" },
    resolve: null,
  });

  const confirm = useCallback((options: ModalOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setModalState({ isOpen: true, options, resolve });
    });
  }, []);

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      setModalState({
        isOpen: true,
        options: { ...options, cancelLabel: undefined },
        resolve: () => resolve() as unknown as boolean,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    modalState.resolve?.(true);
    setModalState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, [modalState.resolve]);

  const handleCancel = useCallback(() => {
    modalState.resolve?.(false);
    setModalState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, [modalState.resolve]);

  const isAlert = !modalState.options.cancelLabel && modalState.options.cancelLabel !== "";

  const ConfirmModalElement = (
    <ConfirmModal
      isOpen={modalState.isOpen}
      title={modalState.options.title}
      message={modalState.options.message}
      variant={modalState.options.variant}
      confirmLabel={modalState.options.confirmLabel}
      cancelLabel={modalState.options.cancelLabel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      showCancel={!isAlert}
    />
  );

  return { confirm, alert, ConfirmModalElement };
}
