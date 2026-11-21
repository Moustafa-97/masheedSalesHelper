import {
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
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
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
import { Repository } from 'typeorm';
import { Roles } from '../common/auth.decorators.js';
import { Role } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { Brand, Product, ProductVariant, Unit } from './product.entities.js';

export class BrandDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
}

export class ProductDto {
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @IsString() @MaxLength(40) category: string;
}

export class CreateVariantDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsString() @MaxLength(60) spec?: string;
  @IsEnum(Unit) unit: Unit;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) minQty: number;
  @IsOptional() @IsString() @MaxLength(120) supplierName?: string;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() @MaxLength(60) spec?: string;
  @IsOptional() @IsEnum(Unit) unit?: Unit;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) minQty?: number;
  @IsOptional() @IsString() @MaxLength(120) supplierName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListVariantsQuery {
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(
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

  /** The catalogue used by orders and quotations: every sellable variant with its product and brand. */
  listVariants(includeInactive = false) {
    return this.variants.find({
      where: includeInactive ? {} : { isActive: true },
      relations: { product: true, brand: true },
      order: { product: { category: 'ASC', name: 'ASC' }, spec: 'ASC' },
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
          minQty: dto.minQty,
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
    return this.variants.findOneOrFail({ where: { id }, relations: { product: true, brand: true } });
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
  imports: [TypeOrmModule.forFeature([Brand, Product, ProductVariant])],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
