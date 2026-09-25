-- CreateTable
CREATE TABLE "coaching_next_goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaching_next_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coaching_next_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaching_next_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coaching_next_goals_userId_idx" ON "coaching_next_goals"("userId");

-- CreateIndex
CREATE INDEX "coaching_next_tasks_goalId_idx" ON "coaching_next_tasks"("goalId");

-- AddForeignKey
ALTER TABLE "coaching_next_goals" ADD CONSTRAINT "coaching_next_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_next_tasks" ADD CONSTRAINT "coaching_next_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_next_tasks" ADD CONSTRAINT "coaching_next_tasks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "coaching_next_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
