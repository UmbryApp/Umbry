import React, { type ChangeEvent, type FC, useCallback, useRef, useState } from 'react';
import AlphaPicker from 'components/alphaPicker/AlphaPickerComponent';
import Input from 'elements/emby-input/Input';
import globalize from 'lib/globalize';
import layoutManager from 'components/layoutManager';
import browser from 'scripts/browser';
import 'material-design-icons-iconfont';
import 'styles/flexstyles.scss';
import './searchfields.scss';
import './jpxSearch.scss';

interface SearchFieldsProps {
    query: string,
    onSearch?: (query: string) => void
}

// Voice input (Moonfin has a mic beside the search pill). Chrome-family exposes
// webkitSpeechRecognition; requires a secure context to actually listen, so the
// button quietly no-ops where unsupported.
interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((e: { results: { [k: number]: { [k: number]: { transcript?: string } } } }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
    stop: () => void;
}
const getSpeechRecognition = (): (new () => SpeechRecognitionLike) | undefined => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    return w.SpeechRecognition || w.webkitSpeechRecognition;
};

const SearchFields: FC<SearchFieldsProps> = ({
    onSearch = () => { /* no-op */ },
    query
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const recRef = useRef<SpeechRecognitionLike | null>(null);
    const [ listening, setListening ] = useState(false);

    const onAlphaPicked = useCallback((e: Event) => {
        const value = (e as CustomEvent).detail.value;
        const inputValue = inputRef.current?.value || '';

        if (value === 'backspace') {
            onSearch(inputValue.length ? inputValue.substring(0, inputValue.length - 1) : '');
        } else {
            onSearch(inputValue + value);
        }
    }, [onSearch]);

    const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        onSearch(e.target.value);
    }, [ onSearch ]);

    const onClear = useCallback(() => {
        onSearch('');
        inputRef.current?.focus();
    }, [ onSearch ]);

    const onMic = useCallback(() => {
        const Ctor = getSpeechRecognition();
        if (!Ctor) return;
        if (recRef.current) {
            try { recRef.current.stop(); } catch { /* ignore */ }
            recRef.current = null;
            setListening(false);
            return;
        }
        try {
            const rec = new Ctor();
            rec.lang = globalize.getCurrentLocale?.() || 'en-US';
            rec.interimResults = false;
            rec.maxAlternatives = 1;
            rec.onresult = (e) => {
                const text = e.results?.[0]?.[0]?.transcript;
                if (text) onSearch(text);
            };
            rec.onend = () => { recRef.current = null; setListening(false); };
            rec.onerror = () => { recRef.current = null; setListening(false); };
            recRef.current = rec;
            setListening(true);
            rec.start();
        } catch {
            recRef.current = null;
            setListening(false);
        }
    }, [ onSearch ]);

    const showMic = !layoutManager.tv && !!getSpeechRecognition();

    return (
        <div className='padded-left padded-right searchFields jpx-search-fields'>
            <div className='jpx-search-row'>
                {showMic && (
                    <button
                        type='button'
                        className={'jpx-search-mic' + (listening ? ' listening' : '')}
                        title='Voice search'
                        onClick={onMic}
                    >
                        <span className='material-icons' aria-hidden='true'>mic</span>
                    </button>
                )}
                <div className='jpx-search-pill searchFieldsInner flex align-items-center justify-content-center'>
                    <span className='searchfields-icon material-icons search' aria-hidden='true' />
                    <div
                        className='inputContainer flex-grow'
                        style={{ marginBottom: 0 }}
                    >
                        <Input
                            ref={inputRef}
                            id='searchTextInput'
                            className='searchfields-txtSearch'
                            type='text'
                            data-keyboard='true'
                            placeholder={globalize.translate('Search')}
                            autoComplete='off'
                            maxLength={40}
                            // eslint-disable-next-line jsx-a11y/no-autofocus
                            autoFocus
                            value={query}
                            onChange={onChange}
                        />
                    </div>
                    {!!query && (
                        <button type='button' className='jpx-search-clear' title='Clear' onClick={onClear}>
                            <span className='material-icons' aria-hidden='true'>close</span>
                        </button>
                    )}
                </div>
            </div>
            {layoutManager.tv && !browser.tv
                && <AlphaPicker onAlphaPicked={onAlphaPicked} />
            }
        </div>
    );
};

export default SearchFields;
