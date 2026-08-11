import { expect, test } from '@playwright/test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { launchElectronHarness } from './electronHarness';

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const sendJson = (response: ServerResponse, body: unknown) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const createResponsesPayload = (agenda: unknown) => ({
  id: 'resp_fake_agenda',
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'completed',
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  model: 'fake-agenda-model',
  output: [
    {
      id: 'msg_fake_agenda',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: JSON.stringify(agenda),
          annotations: [],
          logprobs: [],
        },
      ],
    },
  ],
  parallel_tool_calls: true,
  previous_response_id: null,
  reasoning: { effort: 'medium', summary: null },
  store: true,
  temperature: 1,
  text: { format: { type: 'text' }, verbosity: 'medium' },
  tool_choice: 'auto',
  tools: [],
  top_p: 1,
  truncation: 'disabled',
  usage: {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 100,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 200,
  },
});

test('imports a webpage through a fake Responses server, persists it, and refreshes after restart', async () => {
  let extractionCount = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/agenda') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><body>
        <h1>Loopback Physics Workshop</h1>
        <h2>Tuesday</h2>
        <p>09:00 - 10:00 Opening Physics, Ada Scientist</p>
        <a href="/talk/opening">Opening details</a>
        <p>10:00 Coffee break</p>
        <a href="/slides/opening.pdf">Opening slides</a>
      </body>`);
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/responses') {
      extractionCount += 1;
      const requestBody = JSON.parse(await readRequestBody(request)) as {
        input?: Array<{ content?: string }>;
      };
      const prompt = requestBody.input?.[1]?.content ?? '';
      const priorId = prompt.match(/"contributionId":"([^"]+)"/)?.[1] ?? null;
      const talks = [
        {
          priorId,
          title:
            extractionCount === 1
              ? 'Opening Physics'
              : 'Opening Physics - Updated',
          authors: ['Ada Scientist'],
          sessionTitle: 'Plenary',
          date: '2026-08-11',
          startTime: '09:00',
          endTime: '10:00',
          room: 'Auditorium',
          contributionUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/talk/opening`,
          pdfMaterials: [
            {
              title: 'Opening slides',
              url: `http://127.0.0.1:${(server.address() as { port: number }).port}/slides/opening.pdf`,
            },
          ],
        },
      ];
      if (extractionCount > 1) {
        talks.push({
          priorId: null,
          title: 'New Contributed Result',
          authors: ['Grace Researcher'],
          sessionTitle: 'Contributed talks',
          date: '2026-08-11',
          startTime: '10:15',
          endTime: '10:30',
          room: 'Auditorium',
          contributionUrl: null,
          pdfMaterials: [],
        });
      }
      sendJson(
        response,
        createResponsesPayload({
          event: {
            title: 'Loopback Physics Workshop',
            dates: 'August 11, 2026',
            timeZone: 'America/New_York',
            host: 'Loopback Institute',
          },
          talks,
        }),
      );
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fake agenda server did not expose a TCP port.');
  }
  const sourceUrl = `http://127.0.0.1:${address.port}/agenda`;
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'indicoink-web-agenda-'));

  const firstApp = await launchElectronHarness({ userDataDir });
  try {
    await firstApp.page.getByLabel('Event URL').fill(sourceUrl);
    await firstApp.page.getByRole('button', { name: 'Open event' }).click();
    await expect(
      firstApp.page.getByRole('heading', {
        name: 'Configure OpenAI agenda extraction',
      }),
    ).toBeVisible();
    await firstApp.page.getByLabel('OpenAI endpoint URL').fill(baseUrl);
    await firstApp.page.getByLabel('OpenAI model').fill('fake-agenda-model');
    await firstApp.page.getByLabel('OpenAI API key').fill('fake-local-key');
    await firstApp.page
      .getByRole('button', { name: 'Save and continue' })
      .click();

    await expect(
      firstApp.page.getByRole('heading', {
        name: 'Loopback Physics Workshop',
        level: 1,
      }),
    ).toBeVisible();
    await expect(firstApp.page.getByText('Opening Physics')).toBeVisible();
  } finally {
    await firstApp.close();
  }

  const secondApp = await launchElectronHarness({ userDataDir });
  try {
    await secondApp.page
      .getByRole('button', { name: 'Open Loopback Physics Workshop' })
      .click();
    await expect(secondApp.page.getByText('Opening Physics')).toBeVisible();
    await secondApp.page.getByRole('button', { name: 'Refresh' }).click();
    await expect(
      secondApp.page.getByText('Opening Physics - Updated'),
    ).toBeVisible();
    await expect(
      secondApp.page.getByText('New Contributed Result'),
    ).toBeVisible();
    expect(extractionCount).toBe(2);
  } finally {
    await secondApp.close();
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
  }
});
