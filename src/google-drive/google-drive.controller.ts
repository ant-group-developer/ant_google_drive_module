
import { Body, Controller, Post, UploadedFile } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';
import { UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('google-drive')
export class GoogleDriveController {
    constructor(private readonly googleDriveService: GoogleDriveService) { }

    @Post('upload-large-file')
    @UseInterceptors(FileInterceptor('file'))
    async uploadLargeFile(
        @UploadedFile() file: Express.Multer.File,
        @Body() body: { chunkSize?: number, folderId: string },
    ): Promise<any> {
        return this.googleDriveService.uploadLargeFile(file, Number(body.chunkSize), body.folderId);
    }

    @Post('upload/chunk')
    @UseInterceptors(FileInterceptor('chunk'))
    async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { originalName: string, index: number }
    ) {
        return this.googleDriveService.uploadFileChunk(file, Number(body.index), body.originalName);
    }

    @Post('upload/complete')
    async completeUpload(
    @Body() body: { originalName: string, folderId: string }
    ) {
        return this.googleDriveService.completeUpload(body.originalName, body.folderId);
    }
}
