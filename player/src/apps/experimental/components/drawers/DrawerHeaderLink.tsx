import Box from '@mui/material/Box';
import React from 'react';

import ListItemLink from 'components/ListItemLink';

import jpxLogo from '../../../../assets/img/umbry-wordmark.png';

// Umbry: the drawer header is the brand wordmark (Moonfin-style), linking Home.
const DrawerHeaderLink = () => {
    return (
        <ListItemLink to='/home' sx={{ justifyContent: 'center', py: 1.5 }}>
            <Box
                component='img'
                src={jpxLogo}
                alt='Umbry'
                className='jpx-sidebar-logo'
                sx={{
                    width: '100%',
                    maxWidth: 150,
                    maxHeight: 96,
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                    mx: 'auto'
                }}
            />
        </ListItemLink>
    );
};

export default DrawerHeaderLink;
