import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { AccountService } from './account.service.js';
import { ClientAccountController } from './client-account.controller.js';
import { FileStorage, LocalFileStorage } from './file-storage.js';
import { FilesController } from './files.controller.js';
import {
  ClientProject,
  Delivery,
  DeliveryLine,
  Order,
  OrderDocument,
  OrderEvent,
  OrderLine,
  Payment,
  SalesInvoice,
  StoredFile,
} from './order.entities.js';
import {
  AddDeliveryDto,
  AddDocumentDto,
  AddInvoiceDto,
  CreateOrderDto,
  ListOrdersQuery,
  OrderLineDto,
  PurchasePriceDto,
  ReasonDto,
  StatusDto,
  UpdateLineDto,
  UpdateOrderDto,
} from './orders.dto.js';
import { OrdersExportService } from './orders-export.service.js';
import { OrdersService } from './orders.service.js';

const Id = () => Param('id', ParseUUIDPipe);

@Controller('orders')
@Roles(Role.ADMIN, Role.REP)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly exporter: OrdersExportService,
  ) {}

  @Get()
  list(@CurrentUser() user: User, @Query() query: ListOrdersQuery) {
    return this.orders.list(user, query);
  }

  /** Same filters as the list, as an Excel workbook. */
  @Get('export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async export(@CurrentUser() user: User, @Query() query: ListOrdersQuery) {
    const name = `orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new StreamableFile(await this.exporter.workbook(user, query), {
      disposition: `attachment; filename="${name}"`,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Id() id: string) {
    return this.orders.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Id() id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(user, id, dto);
  }

  @Put(':id/status')
  status(@CurrentUser() user: User, @Id() id: string, @Body() dto: StatusDto) {
    return this.orders.setStatus(user, id, dto.status);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: User, @Id() id: string, @Body() dto: ReasonDto) {
    return this.orders.cancel(user, id, dto.reason);
  }

  @Post(':id/lines')
  addLine(@CurrentUser() user: User, @Id() id: string, @Body() dto: OrderLineDto) {
    return this.orders.addLine(user, id, dto);
  }

  @Patch(':id/lines/:lineId')
  updateLine(
    @CurrentUser() user: User,
    @Id() id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateLineDto,
  ) {
    return this.orders.updateLine(user, id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  removeLine(
    @CurrentUser() user: User,
    @Id() id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.removeLine(user, id, lineId, dto.reason);
  }

  @Put(':id/purchase-price')
  purchasePrice(@CurrentUser() user: User, @Id() id: string, @Body() dto: PurchasePriceDto) {
    return this.orders.setPurchasePrice(user, id, dto.purchasePrice);
  }

  @Post(':id/documents')
  addDocument(@CurrentUser() user: User, @Id() id: string, @Body() dto: AddDocumentDto) {
    return this.orders.addDocument(user, id, dto);
  }

  @Delete(':id/documents/:documentId')
  removeDocument(
    @CurrentUser() user: User,
    @Id() id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.removeDocument(user, id, documentId, dto.reason);
  }

  @Post(':id/deliveries')
  addDelivery(@CurrentUser() user: User, @Id() id: string, @Body() dto: AddDeliveryDto) {
    return this.orders.addDelivery(user, id, dto);
  }

  @Delete(':id/deliveries/:deliveryId')
  removeDelivery(
    @CurrentUser() user: User,
    @Id() id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.removeDelivery(user, id, deliveryId, dto.reason);
  }

  @Post(':id/invoices')
  addInvoice(@CurrentUser() user: User, @Id() id: string, @Body() dto: AddInvoiceDto) {
    return this.orders.addInvoice(user, id, dto);
  }

  @Delete(':id/invoices/:invoiceId')
  removeInvoice(
    @CurrentUser() user: User,
    @Id() id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.removeInvoice(user, id, invoiceId, dto.reason);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoredFile,
      ClientProject,
      Order,
      OrderLine,
      OrderDocument,
      Delivery,
      DeliveryLine,
      SalesInvoice,
      Payment,
      OrderEvent,
    ]),
  ],
  controllers: [OrdersController, ClientAccountController, FilesController],
  providers: [
    AccountService,
    OrdersService,
    OrdersExportService,
    { provide: FileStorage, useClass: LocalFileStorage },
  ],
})
export class OrdersModule {}
