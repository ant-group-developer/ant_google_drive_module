
import { Body, Controller, Post, UploadedFile, Get, Param, Delete, Res } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';
import { UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

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
        @Body() body: { originalName: string, folderId: string, chunkNumber: number }
    ) {
        return this.googleDriveService.completeUpload(body.originalName, body.folderId, body.chunkNumber);
    }

    //Lấy metadata của fileId hoặc folderId
    @Post('meta-data/:fileId')
    async getMetaDataById(@Param('fileId') fileId: string){
        return this.googleDriveService.getMetaDataById(fileId);
    }

    // Lấy danh sách các folder trong thư mục gốc
    @Get('list-folder')
    async getListRoot() {
        return this.googleDriveService.getChildFolders();
    }

    // Lấy danh sách các folder trong thư mục chỉ định bằng folderId
    @Get('list-folder/:folderId')
    async getListFolder(@Param('folderId') folderId: string) {
        return this.googleDriveService.getChildFolders(folderId);
    }

    // Lấy danh sách các file trong thư mục chỉ định bằng folderId (1 cấp)
    @Get('list-files/:folderId')
    async getListFilesByFolderId(@Param('folderId') folderId: string) {
        return this.googleDriveService.getListFilesByFolderId(folderId);
    }

    // Xóa file
    @Delete('delete-file/:fileId')
    async deleteFileById(@Param('fileId') fileId: string) {
        return this.googleDriveService.deleteFileById(fileId);
    }

    // Download file
    @Get('download-file/:fileId')
    async downloadFile(@Param('fileId') fileId: string, @Res() res: Response) {
        const { stream, fileName } = await this.googleDriveService.downloadFile(fileId);

        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        });

        stream.pipe(res);
    }

    //Download Folder
    @Get('download-folder/:folderId')
    async downloadFolder(
        @Param('folderId') folderId: string,
        @Res() res: Response
    ) {
        const { stream, fileName } = await this.googleDriveService.downloadFolder(folderId);

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
        });

        stream.pipe(res);
    }
}