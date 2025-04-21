#!/usr/bin/env node

import { main } from './index.ts'

void main().then((exitCode) => process.exitCode = exitCode)
