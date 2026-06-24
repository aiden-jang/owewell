-- AlterEnum
ALTER TYPE "SplitMethod" ADD VALUE 'ITEMIZED';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tipCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "expense_items" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_item_shares" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "expense_item_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_items_expenseId_idx" ON "expense_items"("expenseId");

-- CreateIndex
CREATE INDEX "expense_item_shares_userId_idx" ON "expense_item_shares"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_item_shares_itemId_userId_key" ON "expense_item_shares"("itemId", "userId");

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item_shares" ADD CONSTRAINT "expense_item_shares_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "expense_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_item_shares" ADD CONSTRAINT "expense_item_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
