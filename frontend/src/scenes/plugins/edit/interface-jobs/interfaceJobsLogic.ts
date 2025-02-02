import type { FormInstance } from 'antd/lib/form/hooks/useForm.d'
import { actions, kea, key, connect, events, listeners, path, props, reducers } from 'kea'
import { forms } from 'kea-forms'
import api from 'lib/api'
import type { interfaceJobsLogicType } from './interfaceJobsLogicType'
import { pluginsLogic } from 'scenes/plugins/pluginsLogic'
import { JobSpec } from '~/types'
import { lemonToast } from 'lib/components/lemonToast'
import { validateJson } from '../../../../lib/utils'

export const interfaceJobsLogic = kea<interfaceJobsLogicType>([
    path(['scenes', 'plugins', 'edit', 'interface-jobs', 'interfaceJobsLogic']),
    props(
        {} as {
            jobName: string
            pluginConfigId: number
            pluginId: number
            jobSpecPayload: JobSpec['payload']
        }
    ),
    key((props) => {
        return `${props.pluginId}_${props.jobName}`
    }),
    connect({
        actions: [pluginsLogic, ['showPluginLogs']],
    }),
    actions({
        setIsJobModalOpen: (isOpen: boolean) => ({ isOpen }),
        setRunJobAvailable: (isAvailable: boolean) => ({ isAvailable }),
        runJob: (form: FormInstance<any>) => ({ form }),
        playButtonOnClick: (jobHasEmptyPayload: boolean) => ({ jobHasEmptyPayload }),
        setRunJobAvailableTimeout: (timeout: number) => ({ timeout }),
    }),
    reducers({
        isJobModalOpen: [
            false,
            {
                setIsJobModalOpen: (_, { isOpen }) => isOpen,
            },
        ],
        runJobAvailable: [
            true,
            {
                setRunJobAvailable: (_, { isAvailable }) => isAvailable,
            },
        ],
        runJobAvailableTimeout: [
            null as number | null,
            {
                setRunJobAvailableTimeout: (_, { timeout }) => timeout,
            },
        ],
    }),
    listeners(({ actions, values }) => ({
        playButtonOnClick: ({ jobHasEmptyPayload }) => {
            if (!values.runJobAvailable) {
                return
            }
            if (jobHasEmptyPayload) {
                actions.submitJobPayload()
                return
            }
            actions.setIsJobModalOpen(true)
        },
    })),
    forms(({ actions, props, values }) => ({
        jobPayload: {
            defaults: Object.fromEntries(
                Object.entries(props.jobSpecPayload || {})
                    .filter(([, spec]) => 'default' in spec)
                    .map(([key, spec]) => [key, spec.default])
            ) as Record<string, any>,

            errors: (payload: Record<string, any>) => {
                const errors = {}
                for (const key of Object.keys(props.jobSpecPayload || {})) {
                    const spec = props.jobSpecPayload?.[key]
                    if (spec?.required && payload[key] == undefined) {
                        errors[key] = 'Please enter a value'
                    } else if (spec?.type == 'json' && !validateJson(payload[key])) {
                        errors[key] = 'Please enter valid JSON'
                    }
                }
                return errors
            },

            submit: async (payload) => {
                actions.setIsJobModalOpen(false)

                try {
                    await api.create(`api/plugin_config/${props.pluginConfigId}/job`, {
                        job: {
                            type: props.jobName,
                            payload,
                        },
                    })
                } catch (error) {
                    lemonToast.error(`Enqueuing job "${props.jobName}" failed`)
                    return
                }

                actions.showPluginLogs(props.pluginId)

                // temporary handling to prevent people from rage
                // clicking and creating multiple jobs - this will be
                // subsituted by better feedback tools like progress bars
                actions.setRunJobAvailable(false)
                if (values.runJobAvailableTimeout) {
                    clearTimeout(values.runJobAvailableTimeout)
                }
                const timeout = window.setTimeout(() => {
                    actions.setRunJobAvailable(true)
                }, 15000)
                actions.setRunJobAvailableTimeout(timeout)

                lemonToast.success('Job has been enqueued')
            },
        },
    })),
    events(({ values }) => ({
        beforeUnmount: () => {
            if (values.runJobAvailableTimeout) {
                clearTimeout(values.runJobAvailableTimeout)
            }
        },
    })),
])
