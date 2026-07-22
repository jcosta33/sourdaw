/**
 * Use-case surface for Automation's segment-curve evaluator. Exposed so
 * offline renderers (e.g. AudioEngine's export scheduler) can conformance-
 * test their local replicas against the reference implementation instead of
 * importing the service directly (services are not a cross-module barrel).
 */
export { interpolateAutomationPointValue } from '../../services/automationPointAlgorithms';
