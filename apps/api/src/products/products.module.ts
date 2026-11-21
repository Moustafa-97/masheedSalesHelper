import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { Roles } from '../common/auth.decorators.js';
import { Role } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { ErpFormatError, groupErpRows, readErpWorkbook } from './erp-catalogue.js';
import { Brand, Product, ProductVariant, Unit, VariantZone } from './product.entities.js';

export class BrandDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
}

export class ProductDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @IsString() @MaxLength(40) category: string;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
}

export class CreateVariantDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsString() @MaxLength(60) spec?: string;
  @IsEnum(Unit) unit: Unit;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) minQty?: number | null;
  @IsOptional() @IsString() @MaxLength(120) supplierName?: string;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() @MaxLength(60) spec?: string;
  @IsOptional() @IsEnum(Unit) unit?: Unit;
  /** null clears the minimum. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) minQty?: number | null;
  @IsOptional() @IsString() @MaxLength(120) supplierName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListVariantsQuery {
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export interface ImportSummary {
  rows: number;
  items: number;
  brandsCreated: number;
  productsCreated: number;
  variantsCreated: number;
  variantsUpdated: number;
  zones: number;
  /** Items imported earlier that are not in this file (left as they are). */
  notInFile: number;
}

/** The part of Multer's file object this module uses. */
interface UploadedXlsx {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const chunk = <T>(arr: T[], size = 500) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

@Injectable()
export class ProductsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Brand) private readonly brands: Repository<Brand>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variants: Repository<ProductVariant>,
  ) {}

  listBrands() {
    return this.brands.find({ order: { name: 'ASC' } });
  }

  async createBrand(dto: BrandDto) {
    try {
      return await this.brands.save(this.brands.create({ name: dto.name.trim(), nameEn: dto.nameEn ?? null }));
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Brand already exists');
      throw e;
    }
  }

  listProducts() {
    return this.products.find({ order: { category: 'ASC', name: 'ASC' } });
  }

  async createProduct(dto: ProductDto) {
    try {
      return await this.products.save(
        this.products.create({ name: dto.name.trim(), nameEn: dto.nameEn ?? null, category: dto.category }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Product already exists');
      throw e;
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const changes = { ...dto, ...(dto.name !== undefined && { name: dto.name.trim() }) };
    try {
      const result = await this.products.update({ id }, changes);
      if (!result.affected) throw new NotFoundException('Product not found');
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Another product already has this name');
      throw e;
    }
    return this.products.findOneByOrFail({ id });
  }

  /** The catalogue used by orders and quotations: every sellable variant with its product, brand and regions. */
  listVariants(includeInactive = false) {
    return this.variants.find({
      where: includeInactive ? {} : { isActive: true },
      relations: { product: true, brand: true, zones: true },
      order: { product: { category: 'ASC', name: 'ASC' }, spec: 'ASC', zones: { zone: 'ASC', label: 'ASC' } },
    });
  }

  /**
   * Imports Masheed's ERP export. Items are matched by their ERP name, so importing a newer export
   * updates units, colours and regions but keeps the admin's minimum quantities, active flags and
   * product names. Nothing is deleted: items missing from the file are only counted.
   */
  async importErp(file: UploadedXlsx | undefined): Promise<ImportSummary> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the ERP export (.xlsx) as "file"');
    let rows;
    try {
      rows = await readErpWorkbook(file.buffer);
    } catch (e) {
      if (e instanceof ErpFormatError) throw new BadRequestException(e.message);
      throw e;
    }
    const items = groupErpRows(rows);
    if (!items.length) throw new BadRequestException('No products found in the file');

    return this.dataSource.transaction(async (m) => {
      const key = (s: string) => s.trim().toLowerCase();

      // Brands
      const brandByName = new Map((await m.find(Brand)).map((b) => [key(b.name), b]));
      const newBrands = [...new Set(items.map((i) => i.brand))].filter((b) => !brandByName.has(key(b)));
      for (const part of chunk(newBrands)) {
        const res = await m.insert(Brand, part.map((name) => ({ name })));
        part.forEach((name, i) => brandByName.set(key(name), { id: res.identifiers[i].id, name } as Brand));
      }

      // Existing variants (by ERP name) and products (by name)
      const existing = new Map(
        (await m.find(ProductVariant, { where: { erpName: Not(IsNull()) } })).map((v) => [v.erpName!, v]),
      );
      const productByName = new Map((await m.find(Product)).map((p) => [key(p.name), p]));
      const newItems = items.filter((i) => !existing.has(i.erpName));
      const newProducts = new Map<string, { name: string; category: string }>();
      for (const i of newItems) {
        if (!productByName.has(key(i.shortName)) && !newProducts.has(key(i.shortName))) {
          newProducts.set(key(i.shortName), { name: i.shortName, category: i.category });
        }
      }
      for (const part of chunk([...newProducts.values()])) {
        const res = await m.insert(Product, part);
        part.forEach((p, i) => productByName.set(key(p.name), { id: res.identifiers[i].id, ...p } as Product));
      }

      // New variants. Two ERP items that shorten to the same product and brand keep apart by spec.
      const taken = new Set(
        (await m.find(ProductVariant, { select: { productId: true, brandId: true, spec: true } })).map(
          (v) => `${v.productId}|${v.brandId}|${v.spec}`,
        ),
      );
      const toInsert = newItems.map((i) => {
        const productId = productByName.get(key(i.shortName))!.id;
        const brandId = brandByName.get(key(i.brand))!.id;
        let spec = '';
        if (taken.has(`${productId}|${brandId}|${spec}`)) spec = i.erpName.slice(0, 60);
        taken.add(`${productId}|${brandId}|${spec}`);
        return { productId, brandId, spec, unit: i.unit, minQty: null, erpName: i.erpName, colors: i.colors };
      });
      const variantIdByErp = new Map([...existing].map(([name, v]) => [name, v.id]));
      for (const part of chunk(toInsert)) {
        const res = await m.insert(ProductVariant, part);
        part.forEach((v, i) => variantIdByErp.set(v.erpName, res.identifiers[i].id));
      }

      // Existing variants: refresh what the ERP owns (brand, unit, colours), keep the rest.
      const toUpdate = items
        .filter((i) => existing.has(i.erpName))
        .map((i) => {
          const v = existing.get(i.erpName)!;
          return { ...v, brandId: brandByName.get(key(i.brand))!.id, unit: i.unit, colors: i.colors };
        });
      for (const part of chunk(toUpdate)) await m.upsert(ProductVariant, part, ['id']);

      // Regions and loads: replaced by what the file says.
      const ids = items.map((i) => variantIdByErp.get(i.erpName)!);
      for (const part of chunk(ids)) await m.delete(VariantZone, { variantId: In(part) });
      const zones = items.flatMap((i) => i.zones.map((z) => ({ ...z, variantId: variantIdByErp.get(i.erpName)! })));
      for (const part of chunk(zones)) await m.insert(VariantZone, part);

      const notInFile = await m.count(ProductVariant, {
        where: { erpName: Not(IsNull()) },
      }).then((total) => total - items.length);

      return {
        rows: rows.length,
        items: items.length,
        brandsCreated: newBrands.length,
        productsCreated: newProducts.size,
        variantsCreated: toInsert.length,
        variantsUpdated: toUpdate.length,
        zones: zones.length,
        notInFile,
      };
    });
  }

  async createVariant(dto: CreateVariantDto) {
    try {
      const saved = await this.variants.save(
        this.variants.create({
          productId: dto.productId,
          brandId: dto.brandId ?? null,
          spec: dto.spec?.trim() ?? '',
          unit: dto.unit,
          minQty: dto.minQty ?? null,
          supplierName: dto.supplierName ?? null,
        }),
      );
      return this.getVariant(saved.id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('This product, brand and size already exist');
      if ((e as any)?.driverError?.code === '23503') throw new NotFoundException('Product or brand not found');
      throw e;
    }
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    const result = await this.variants.update({ id }, dto);
    if (!result.affected) throw new NotFoundException('Variant not found');
    return this.getVariant(id);
  }

  getVariant(id: string) {
    return this.variants.findOneOrFail({ where: { id }, relations: { product: true, brand: true, zones: true } });
  }
}

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('brands')
  listBrands() {
    return this.products.listBrands();
  }

  @Post('brands')
  @Roles(Role.ADMIN)
  createBrand(@Body() dto: BrandDto) {
    return this.products.createBrand(dto);
  }

  @Get('products')
  @Roles(Role.ADMIN, Role.REP)
  listProducts() {
    return this.products.listProducts();
  }

  @Post('products')
  @Roles(Role.ADMIN)
  createProduct(@Body() dto: ProductDto) {
    return this.products.createProduct(dto);
  }

  @Patch('products/:id')
  @Roles(Role.ADMIN)
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.products.updateProduct(id, dto);
  }

  /** Upload Masheed's ERP product export (.xlsx, multipart field "file"). */
  @Post('products/import')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importErp(@UploadedFile() file: UploadedXlsx | undefined) {
    return this.products.importErp(file);
  }

  @Get('variants')
  @Roles(Role.ADMIN, Role.REP)
  listVariants(@Query() query: ListVariantsQuery) {
    return this.products.listVariants(query.includeInactive);
  }

  @Post('variants')
  @Roles(Role.ADMIN)
  createVariant(@Body() dto: CreateVariantDto) {
    return this.products.createVariant(dto);
  }

  @Patch('variants/:id')
  @Roles(Role.ADMIN)
  updateVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Brand, Product, ProductVariant, VariantZone])],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
