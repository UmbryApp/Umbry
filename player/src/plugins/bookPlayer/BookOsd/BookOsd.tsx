import React, { type FC, useCallback, useEffect, useRef, useState } from 'react';

import './BookOsd.scss';
import IconButton from '../../../elements/emby-button/IconButton';
import globalize from 'lib/globalize';

interface BookOsdProps {
    title: string;
    onExit: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onOpenTableOfContents?: () => void;
    onRotateTheme?: () => void;
    onDecreaseFontSize?: () => void;
    onIncreaseFontSize?: () => void;
    onToggleFullscreen?: () => void;
    // Umbry: 0..1 reading progress, polled so the bottom bar shows position + percent (Moonfin).
    getProgress?: () => number;
}

const BookOsd: FC<BookOsdProps> = ({
    title,
    onExit,
    onPrevious,
    onNext,
    onOpenTableOfContents,
    onRotateTheme,
    onDecreaseFontSize,
    onIncreaseFontSize,
    onToggleFullscreen,
    getProgress
}) => {
    const [fullscreen, setFullscreen] = useState(false);
    const [pct, setPct] = useState(0);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const onClickFullscreen = useCallback(() => {
        onToggleFullscreen?.();
        setFullscreen(state => !state);
    }, [onToggleFullscreen]);

    useEffect(() => {
        if (!getProgress) return;
        const tick = () => {
            const v = getProgress();
            if (typeof v === 'number' && !isNaN(v)) setPct(Math.max(0, Math.min(100, v * 100)));
        };
        tick();
        timer.current = setInterval(tick, 1000);
        return () => { if (timer.current) clearInterval(timer.current); };
    }, [getProgress]);

    return (
        <div className='bookOsd jpx-book-osd'>
            <div className='bookOsdRow bookOsdTop'>
                <IconButton onClick={onExit} icon='arrow_back' title={globalize.translate('ButtonBack')} />
                <span className='bookOsdTitle'>{title}</span>
                <span className='jpx-book-osd-spacer' />
                {onOpenTableOfContents && (
                    <IconButton onClick={onOpenTableOfContents} icon='toc' title={globalize.translate('TableOfContents')} />
                )}
                {onDecreaseFontSize && (
                    <IconButton onClick={onDecreaseFontSize} icon='text_decrease' title={globalize.translate('Smaller')} />
                )}
                {onIncreaseFontSize && (
                    <IconButton onClick={onIncreaseFontSize} icon='text_increase' title={globalize.translate('Larger')} />
                )}
                {onRotateTheme && (
                    <IconButton onClick={onRotateTheme} icon='remove_red_eye' title={globalize.translate('LabelTheme')} />
                )}
                {onToggleFullscreen && (
                    <IconButton
                        onClick={onClickFullscreen}
                        icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'}
                        title={globalize.translate(fullscreen ? 'ExitFullscreen' : 'Fullscreen')}
                    />
                )}
            </div>

            <div className='bookOsdRow bookOsdBottom'>
                <IconButton onClick={onPrevious} icon='navigate_before' title={globalize.translate('Previous')} />
                <div className='jpx-book-osd-progress'>
                    <div className='jpx-book-osd-track'>
                        <div className='jpx-book-osd-fill' style={{ width: pct + '%' }} />
                    </div>
                    <span className='jpx-book-osd-pct'>{Math.round(pct)}%</span>
                </div>
                <IconButton onClick={onNext} icon='navigate_next' title={globalize.translate('Next')} />
            </div>
        </div>
    );
};

export default BookOsd;
