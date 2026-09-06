import React, { FC, useCallback } from 'react';
import AbcIcon from '@mui/icons-material/Abc';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import globalize from 'lib/globalize';
import type { LibraryViewSettings } from 'types/library';

const LETTER_VALUES = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

interface AlphabetButtonProps {
    libraryViewSettings: LibraryViewSettings;
    setLibraryViewSettings: React.Dispatch<React.SetStateAction<LibraryViewSettings>>;
}

// The A–Z jump lives in a toolbar button (next to Sort/Filter) instead of a fixed rail down the side.
const AlphabetButton: FC<AlphabetButtonProps> = ({
    libraryViewSettings,
    setLibraryViewSettings
}) => {
    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    const handleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    }, []);
    const handleClose = useCallback(() => setAnchorEl(null), []);

    const pick = useCallback(
        (_event: React.MouseEvent<HTMLElement>, value: string | null) => {
            setLibraryViewSettings((prev) => ({ ...prev, StartIndex: 0, Alphabet: value }));
            setAnchorEl(null);
        },
        [setLibraryViewSettings]
    );
    const clear = useCallback(() => {
        setLibraryViewSettings((prev) => ({ ...prev, StartIndex: 0, Alphabet: null }));
        setAnchorEl(null);
    }, [setLibraryViewSettings]);

    return (
        <>
            <Button
                title={globalize.translate('ButtonAlphabetPicker') || 'A–Z'}
                onClick={handleClick}
            >
                <AbcIcon />
            </Button>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Box sx={{ p: 1.4, width: 264 }}>
                    <Button
                        size='small'
                        fullWidth
                        variant={libraryViewSettings.Alphabet ? 'outlined' : 'contained'}
                        onClick={clear}
                        sx={{ mb: 1.2 }}
                    >
                        {globalize.translate('All') || 'All'}
                    </Button>
                    <ToggleButtonGroup
                        value={libraryViewSettings.Alphabet}
                        exclusive
                        color='primary'
                        size='small'
                        // eslint-disable-next-line react/jsx-no-bind
                        onChange={pick}
                        sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', '& .MuiToggleButton-root': { border: '1px solid rgba(255,255,255,0.14)', borderRadius: '9px', minWidth: 36, height: 36, p: 0, fontWeight: 600 } }}
                    >
                        {LETTER_VALUES.map((l) => (
                            <ToggleButton key={l} value={l}>{l}</ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                </Box>
            </Popover>
        </>
    );
};

export default AlphabetButton;
