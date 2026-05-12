import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SearchableSelect.module.css";

export interface SearchableSelectOption {
    value: string;
    label: string;
    searchText?: string;
    disabled?: boolean;
}

interface SearchableSelectProps {
    options: SearchableSelectOption[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    className?: string;
}

export function SearchableSelect(props: SearchableSelectProps) {
    const {
        options,
        value,
        onChange,
        disabled,
        placeholder = "请选择",
        searchPlaceholder = "输入关键字搜索",
        emptyText = "暂无可选项",
        className
    } = props;

    const [open, setOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const rootRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const selectedOption = useMemo(
        () => options.find((item) => item.value === value),
        [options, value]
    );

    const filteredOptions = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();

        if (!normalizedKeyword) {
            return options;
        }

        return options.filter((item) => {
            const source =
                `${item.label} ${item.searchText ?? ""}`.toLowerCase();
            return source.includes(normalizedKeyword);
        });
    }, [keyword, options]);

    useEffect(() => {
        if (!open) {
            setKeyword("");
            return;
        }

        searchInputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handleClickOutside = (event: MouseEvent) => {
            const targetNode = event.target as Node;

            if (!rootRef.current?.contains(targetNode)) {
                setOpen(false);
            }
        };

        window.addEventListener("mousedown", handleClickOutside);

        return () => {
            window.removeEventListener("mousedown", handleClickOutside);
        };
    }, [open]);

    function handleSelect(nextValue: string): void {
        onChange(nextValue);
        setOpen(false);
        setKeyword("");
    }

    const firstEnabledOption = filteredOptions.find((item) => !item.disabled);
    const containerClassName = className
        ? `${styles.container} ${className}`
        : styles.container;

    return (
        <div ref={rootRef} className={containerClassName}>
            <button
                type="button"
                className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            >
                <span
                    className={
                        selectedOption ? styles.value : styles.placeholder
                    }
                >
                    {selectedOption?.label ?? placeholder}
                </span>
                <span
                    className={`${styles.arrow} ${open ? styles.arrowOpen : ""}`}
                    aria-hidden
                >
                    ▼
                </span>
            </button>

            {open ? (
                <div className={styles.dropdown}>
                    <input
                        ref={searchInputRef}
                        className={styles.searchInput}
                        value={keyword}
                        placeholder={searchPlaceholder}
                        onChange={(event) => setKeyword(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                setOpen(false);
                                return;
                            }

                            if (event.key === "Enter" && firstEnabledOption) {
                                event.preventDefault();
                                handleSelect(firstEnabledOption.value);
                            }
                        }}
                    />

                    <div
                        className={styles.optionList}
                        role="listbox"
                        aria-label="searchable-select-options"
                    >
                        {filteredOptions.length === 0 ? (
                            <p className={styles.empty}>{emptyText}</p>
                        ) : (
                            filteredOptions.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    className={`${styles.option} ${item.value === value ? styles.optionSelected : ""}`}
                                    disabled={item.disabled}
                                    onClick={() => handleSelect(item.value)}
                                >
                                    {item.label}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
