import { RetryError } from '@posthog/plugin-scaffold'
import * as Sentry from '@sentry/node'
import { TaskList } from 'graphile-worker'

import { EnqueuedJob, Hub, JobQueue, JobQueueType } from '../../types'
import { instrument } from '../../utils/metrics'
import { runRetriableFunction } from '../../utils/retries'
import { status } from '../../utils/status'
import { logOrThrowJobQueueError } from '../../utils/utils'
import { jobQueueMap } from './job-queues'

export interface InstrumentationContext {
    key: string
    tag: string
}

export class JobQueueManager implements JobQueue {
    pluginsServer: Hub
    jobQueues: JobQueue[]
    jobQueueTypes: JobQueueType[]

    constructor(pluginsServer: Hub) {
        this.pluginsServer = pluginsServer

        this.jobQueueTypes = pluginsServer.JOB_QUEUES.split(',')
            .map((q) => q.trim() as JobQueueType)
            .filter((q) => !!q)

        this.jobQueues = this.jobQueueTypes.map((queue): JobQueue => {
            if (jobQueueMap[queue]) {
                return jobQueueMap[queue].getQueue(pluginsServer)
            } else {
                throw new Error(`Unknown job queue "${queue}"`)
            }
        })
    }

    async connectProducer(): Promise<void> {
        const toRemove = new Set<JobQueue>()
        await Promise.all(
            this.jobQueues.map(async (jobQueue, index) => {
                const jobQueueType = this.jobQueueTypes[index]
                try {
                    await jobQueue.connectProducer()
                    status.info('🚶', `Connected to job queue producer "${jobQueueType}"`)
                } catch (error) {
                    toRemove.add(jobQueue)
                    logOrThrowJobQueueError(
                        this.pluginsServer,
                        error,
                        `Cannot start job queue producer "${jobQueueType}": ${error.message}`
                    )
                }
            })
        )
        if (toRemove.size > 0) {
            this.jobQueues = this.jobQueues.filter((jobQueue) => !toRemove.has(jobQueue))
        }
    }

    async enqueue(jobName: string, job: EnqueuedJob, instrumentationContext?: InstrumentationContext): Promise<void> {
        const jobType = 'type' in job ? job.type : 'buffer'
        const jobPayload = 'payload' in job ? job.payload : job.eventPayload
        const pluginServerMode = this.pluginsServer.PLUGIN_SERVER_MODE ?? 'full'
        await instrument(
            this.pluginsServer.statsd,
            {
                metricName: 'job_queues_enqueue',
                key: instrumentationContext?.key ?? '?',
                tag: instrumentationContext?.tag ?? '?',
                tags: { jobName, type: jobType },
                data: { timestamp: job.timestamp, type: jobType, payload: jobPayload },
            },
            () =>
                runRetriableFunction({
                    hub: this.pluginsServer,
                    metricName: 'job_queues_enqueue',
                    metricTags: {
                        pluginServerMode,
                        jobName,
                    },
                    tryFn: async () => this._enqueue(jobName, job),
                    catchFn: () => status.error('🔴', 'Exhausted attempts to enqueue job.'),
                    payload: job,
                })
        )
    }

    async _enqueue(jobName: string, job: EnqueuedJob): Promise<void> {
        for (const jobQueue of this.jobQueues) {
            try {
                await jobQueue.enqueue(jobName, job)
                this.pluginsServer.statsd?.increment('enqueue_job.success', { jobName })
                return
            } catch (error) {
                // if one fails, take the next queue
                Sentry.captureException(error, {
                    extra: {
                        job: JSON.stringify(job),
                        queue: jobQueue.toString(),
                        queues: this.jobQueues.map((q) => q.toString()),
                    },
                })
            }
        }

        this.pluginsServer.statsd?.increment('enqueue_job.fail', { jobName })

        const error = new RetryError('No JobQueue available')
        Sentry.captureException(error, {
            extra: {
                jobName,
                job: JSON.stringify(job),
                queues: this.jobQueues.map((q) => q.toString()),
            },
        })

        status.warn('⚠️', 'Failed to enqueue job.')
        throw error
    }

    async disconnectProducer(): Promise<void> {
        await Promise.all(this.jobQueues.map((r) => r.disconnectProducer()))
    }

    async startConsumer(jobHandlers: TaskList): Promise<void> {
        await Promise.all(this.jobQueues.map((r) => r.startConsumer(jobHandlers)))
    }

    async stopConsumer(): Promise<void> {
        await Promise.all(this.jobQueues.map((r) => r.stopConsumer()))
    }

    async pauseConsumer(): Promise<void> {
        await Promise.all(this.jobQueues.map((r) => r.pauseConsumer()))
    }

    isConsumerPaused(): boolean {
        return !!this.jobQueues.find((r) => r.isConsumerPaused())
    }

    async resumeConsumer(): Promise<void> {
        await Promise.all(this.jobQueues.map((r) => r.resumeConsumer()))
    }

    getJobQueueTypesAsString(): string {
        return this.jobQueueTypes.join(',')
    }
}
