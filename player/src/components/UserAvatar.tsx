import React, { type FC } from 'react';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import Avatar, { type AvatarProps } from '@mui/material/Avatar';
import type {} from '@mui/material/themeCssVarsAugmentation';

import { useApi } from 'hooks/useApi';

interface UserAvatarProps extends AvatarProps {
    user?: UserDto,
    size?: number
}

const UserAvatar: FC<UserAvatarProps> = ({
    user,
    size
}) => {
    const { api } = useApi();

    // Umbry: Plex users carry an ABSOLUTE avatar URL (plex.tv) in PrimaryImageTag — use it
    // directly; Jellyfin/Emby carry an image tag we turn into the server's image endpoint.
    const tag = user?.PrimaryImageTag;
    const imageUrl = tag && /^https?:\/\//.test(tag)
        ? tag
        : (api && user?.Id && tag ? `${api.basePath}/Users/${user.Id}/Images/Primary?tag=${tag}` : undefined);

    return user ? (
        <Avatar
            alt={user.Name ?? undefined}
            src={imageUrl}
            // eslint-disable-next-line react/jsx-no-bind
            sx={(theme) => ({
                bgcolor: imageUrl ?
                    theme.vars.palette.background.paper :
                    theme.vars.palette.primary.dark,
                color: 'inherit',
                width: size,
                height: size
            })}
        />
    ) : null;
};

export default UserAvatar;
