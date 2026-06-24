import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { GroupError, requireMembership } from '../groups/groups.service.js';
import { createReceiptExtractor } from '../../ocr/extractor.js';

export async function ocrRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } });

  app.post<{ Params: { id: string } }>(
    '/groups/:id/ocr',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        await requireMembership(app.prisma, request.user!.id, request.params.id);
      } catch (err) {
        if (err instanceof GroupError) {
          reply.code(404);
          return { error: err.code, message: err.message };
        }
        throw err;
      }

      const file = await request.file();
      if (!file) {
        reply.code(400);
        return { error: 'NoFile', message: 'Attach a receipt image.' };
      }

      const buffer = await file.toBuffer();
      try {
        const receipt = await createReceiptExtractor().extract(buffer, file.mimetype);
        return { receipt };
      } catch (err) {
        request.log.error({ err }, 'receipt OCR failed');
        reply.code(502);
        return { error: 'OcrFailed', message: 'Could not read that receipt.' };
      }
    },
  );
}
