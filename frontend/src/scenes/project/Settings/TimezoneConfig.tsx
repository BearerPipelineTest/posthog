import { Skeleton } from 'antd'
import { useActions, useValues } from 'kea'
import React from 'react'
import { preflightLogic } from 'scenes/PreflightCheck/preflightLogic'
import { teamLogic } from 'scenes/teamLogic'

import { LemonSelectMultiple } from 'lib/components/LemonSelectMultiple/LemonSelectMultiple'
import { LemonDialog } from 'lib/components/LemonDialog'

export function TimezoneConfig(): JSX.Element {
    const { preflight } = useValues(preflightLogic)
    const { currentTeam, currentTeamLoading } = useValues(teamLogic)
    const { updateCurrentTeam } = useActions(teamLogic)

    if (!preflight?.available_timezones || !currentTeam) {
        return <Skeleton paragraph={{ rows: 0 }} active />
    }
    function onChange(val: string): void {
        LemonDialog.open({
            title: `Do you want to change the timezone of this project?`,
            description:
                'This will change how every graph in this project is calculated, which means your data will look different than it did before.',
            primaryButton: {
                children: 'Change timezone',
                status: 'danger',
                onClick: () => updateCurrentTeam({ timezone: val }),
            },
            secondaryButton: {
                children: 'Cancel',
            },
        })
    }

    const options = Object.entries(preflight.available_timezones).map(([tz, offset]) => {
        const label = `${tz.replace(/\//g, ' / ').replace(/_/g, ' ')} (UTC${offset > 0 ? '+' : '-'}${Math.abs(offset)})`
        return {
            key: tz,
            label: label,
        }
    })

    return (
        <LemonSelectMultiple
            mode="single"
            placeholder="Select a timezone"
            loading={currentTeamLoading}
            disabled={currentTeamLoading}
            value={[currentTeam.timezone]}
            onChange={(val) => onChange(val as any)}
            options={options}
            data-attr="timezone-select"
        />
    )
}
