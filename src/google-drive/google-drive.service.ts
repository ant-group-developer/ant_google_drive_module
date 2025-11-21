import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config();

@Injectable()
export class GoogleDriveService {
    private readonly MAX_CHUNK: number = Number(process.env.MAX_CHUNK_SIZE) || 50 * 1024;
    private drive;

    constructor() {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI,
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        });

        this.drive = google.drive({
            version: 'v3',
            auth: oauth2Client,
        });
    }

    async uploadMergedFileToDrive(finalPath: string, folderId: string) {
        try {
            const fileName = path.basename(finalPath);
            const mimeType = 'application/octet-stream';

            const res = await this.drive.files.create({
                requestBody: {
                    name: fileName,
                    parents: [folderId],
                },
                media: {
                    mimeType,
                    body: fs.createReadStream(finalPath),
                },
                fields: 'id',
                resumable: true,
            });

            return { fileName, driveId: res.data.id };
        } catch (error) {
            throw new Error(error)
        }
    }

    async uploadFileChunk(
        chunk: Express.Multer.File,
        index: number,
        originalName: string
    ) {
        if (!chunk) throw new Error('Chunk not found');

        const tmpDir = path.join(process.cwd(), 'tmp', originalName);
        await fs.promises.mkdir(tmpDir, { recursive: true });

        const chunkPath = path.join(tmpDir, `${originalName}_chunk_${index}`);
        await fs.promises.writeFile(chunkPath, chunk.buffer);

        return { index, path: chunkPath };
    }

    async mergeChunksDisk(originalName: string) {
        try {
            const tmpDir = path.join(process.cwd(), 'tmp', originalName);
            const finalPath = path.join(tmpDir, originalName);

            const files = await fs.promises.readdir(tmpDir);

            const chunkFiles = files
                .filter(name => name.startsWith(`${originalName}_chunk_`))
                .map(name => {
                    const index = Number(name.replace(`${originalName}_chunk_`, ""));
                    return { name, index };
                });

            chunkFiles.sort((a, b) => a.index - b.index);

            const writeStream = fs.createWriteStream(finalPath);

            for (const chunk of chunkFiles) {
                const chunkPath = path.join(tmpDir, chunk.name);

                const data = await fs.promises.readFile(chunkPath);
                writeStream.write(data);

                await fs.promises.unlink(chunkPath);
            }

            await new Promise<void>((resolve, reject) => {
                writeStream.end(() => resolve());
                writeStream.on('error', reject);
            });

            return finalPath;

        } catch (error) {
            throw new Error(error);
        }
    }

    async mergeChunksFromBuffers(originalName: string, chunks: { index: number; buffer: Buffer }[]) {
        try {
            const tmpDir = path.join(process.cwd(), 'tmp', originalName);
            await fs.promises.mkdir(tmpDir, { recursive: true });

            const finalPath = path.join(tmpDir, originalName);
            const writeStream = fs.createWriteStream(finalPath);

            chunks.sort((a, b) => a.index - b.index);

            for (const chunk of chunks) {
                writeStream.write(chunk.buffer);
            }

            await new Promise<void>((resolve, reject) => {
                writeStream.end(() => resolve());
                writeStream.on('error', (err) => reject(err));
            });

            return finalPath;
        } catch (error) {
            throw new Error(error);
        }
    }


    async cleanupTmp(originalName: string) {
        const tmpDir = path.join(process.cwd(), 'tmp', originalName);
        try {
            await fs.promises.rm(tmpDir, { recursive: true, force: true });
        } catch (err) {
            console.error(`Failed to cleanup tmp dir ${tmpDir}:`, err);
        }
    }

    async uploadLargeFile(
        file: Express.Multer.File,
        chunkSize: number,
        folderId: string
    ) {
        try {
            if (!file) throw new Error('File not found');
            if (!chunkSize) {
                chunkSize = this.MAX_CHUNK;
            }
            const fileBuffer = file.buffer;
            const originalName = file.originalname;
            const realChunkSize = Math.min(this.MAX_CHUNK, chunkSize);
            const chunkCount = Math.ceil(fileBuffer.length / realChunkSize);

            const chunks: { index: number; buffer: Buffer }[] = [];
            for (let i = 0; i < chunkCount; i++) {
                const start = i * realChunkSize;
                const end = Math.min(start + realChunkSize, fileBuffer.length);
                chunks.push({ index: i, buffer: fileBuffer.slice(start, end) });
            }

            const uploadChunk = async (chunk: { index: number; buffer: Buffer }) => {
                let uploaded = false;
                let attempt = 0;
                let result: any;
                while (!uploaded && attempt < 5) {
                    try {
                        result = await this.uploadFileChunk(
                            { buffer: chunk.buffer } as Express.Multer.File,
                            chunk.index,
                            originalName
                        );
                        uploaded = true;
                    } catch (err) {
                        attempt++;
                        await new Promise(res => setTimeout(res, 500 * attempt));
                    }
                }
                if (!uploaded) throw new Error(`Chunk ${chunk.index} failed after 5 attempts`);
                return result;
            };

            let results: any[] = [];
            let pendingChunks = [...chunks];

            while (pendingChunks.length > 0) {
                const settled = await Promise.allSettled(pendingChunks.map(uploadChunk));

                const successful = settled
                    .map((r, i) => ({ r, chunk: pendingChunks[i] }))
                    .filter(x => x.r.status === 'fulfilled');

                results.push(...successful.map(x => x.r));

                pendingChunks = settled
                    .map((r, i) => ({ r, chunk: pendingChunks[i] }))
                    .filter(x => x.r.status === 'rejected')
                    .map(x => x.chunk);
            }

            const mergedFilePath = await this.mergeChunksFromBuffers(originalName, chunks);

            const driveResult = await this.uploadMergedFileToDrive(mergedFilePath, folderId);

            await this.cleanupTmp(originalName);

            return {
                status: 'success',
                fileName: driveResult.fileName,
                driveId: driveResult.driveId,
                linkToFile: `https://drive.google.com/file/d/${driveResult.driveId}`,
                linkToFolder: `https://drive.google.com/drive/folders/${folderId}`,
                chunkCount,
            };
        } catch (error) {
            throw new Error(error);
        }
    }

    async completeUpload(originalName: string, folderId: string) {
        try {
            if (!originalName) throw new Error("originalName is required");
            if (!folderId) throw new Error("folderId is required");

            const finalPath = await this.mergeChunksDisk(originalName);

            const driveResult = await this.uploadMergedFileToDrive(finalPath, folderId);

            await this.cleanupTmp(originalName);

            return {
                status: "success",
                fileName: driveResult.fileName,
                driveId: driveResult.driveId,
                linkToFile: `https://drive.google.com/file/d/${driveResult.driveId}`,
                linkToFolder: `https://drive.google.com/drive/folders/${folderId}`,
            };
        } catch (err) {
            throw new Error(err);
        }
    }
}
